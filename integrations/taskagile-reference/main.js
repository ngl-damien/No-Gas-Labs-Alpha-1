
/**
 * No_Gas_Slaps™ - Main Application Entry Point
 * Production-ready Telegram Mini App for tap-to-earn gaming
 * 
 * @author No_Gas_Slaps™ Development Team
 * @version 2.0.0
 * @license MIT
 */

// Import all game modules
import { initTelegram, getTheme, onThemeChanged, getUser, onReady, onClose, isInsideTelegram, shareScore, hapticFeedback } from './modules/telegram-api.js';
import { initUI, updateUI, announce, focusSlapButton, showOnboarding, hideOnboarding, showHelp, hideLoadingScreen, showToast, updateTheme } from './modules/ui.js';
import { initState, getState, onStateChange, slap, initPowerUps, claimDailyReward, onPowerUpChange, activatePowerUp, getPowerUpsState } from './modules/state.js';
import { initLeaderboard, syncLeaderboard, getLeaderboard, onLeaderboardChange, updateLeaderboard, refreshLeaderboard, getPlayerStats } from './modules/leaderboard-api.js';
import { showError, clearError, showSuccess, onErrorChange, getError, getCurrentSuccess } from './modules/error.js';
import { verifyInitData, sanitizeInput, validateInput } from './modules/security.js';
import { initPersistence, onSyncQueueChange, getOnlineStatus, enqueueSync } from './modules/persistence.js';
import { runUnitTests, logDev, logError, logInfo, setLogLevel } from './modules/testing.js';
import { initAudio, playHitSound, playSuccessSound, playComboSound, toggleMute, playPowerUpSound, playAchievementSound, startBackgroundMusic, playNotificationSound } from './modules/audio.js';
import { initAnimations, triggerSlapAnimation, triggerComboAnimation, triggerPowerUpAnimation, triggerAchievementAnimation, queueAnimation } from './modules/animations.js';
import { loadLocalization, t, formatNumber, formatTime } from './localization/en.js';

/**
 * Application configuration
 */
const APP_CONFIG = {
  version: '2.0.0',
  debug: window.location.hostname === 'localhost',
  features: {
    animations: true,
    audio: true,
    hapticFeedback: true,
    analytics: true,
    autoSave: true,
    backgroundMusic: false,
    particleEffects: true
  },
  performance: {
    maxFPS: 60,
    animationBudget: 16, // ms per frame
    particleLimit: 50,
    soundLimit: 8
  },
  game: {
    maxCombo: 100,
    comboTimeout: 1200,
    autoSaveInterval: 30000,
    leaderboardRefreshInterval: 300000 // 5 minutes
  }
};

// Application state
let appInitialized = false;
let gameLoopId = null;
let lastFrameTime = 0;
let performanceMetrics = {
  fps: 0,
  frameTime: 0,
  loadTime: 0
};

/**
 * Main application initialization
 */
async function initApp() {
  const startTime = performance.now();
  
  try {
    logInfo('🚀 Initializing No_Gas_Slaps™', APP_CONFIG.version);
    
    // Set up loading timeout
    const loadingTimeout = setTimeout(() => {
      logError('App initialization timeout');
      hideLoadingScreen();
      showError(t('errors.initializationFailed', { error: 'Timeout' }));
    }, 30000);
    
    // Set log level based on environment
    setLogLevel(APP_CONFIG.debug ? 'dev' : 'info');
    
    // Initialize localization first
    await loadLocalization('en');
    logDev('✅ Localization initialized');
    
    // Initialize security and validation
    if (isInsideTelegram()) {
      try {
        const initData = window.Telegram?.WebApp?.initData;
        if (initData) {
          await verifyInitData(initData);
          logDev('✅ Telegram init data verified');
        }
      } catch (error) {
        logError('Telegram init data verification failed:', error);
        // Continue anyway for development
      }
    }
    
    // Initialize core systems
    await Promise.all([
      initPersistence(),
      initAudio(),
      initAnimations()
    ]);
    
    // Initialize Telegram integration
    await initTelegram();
    logDev('✅ Telegram integration initialized');
    
    // Initialize game systems
    await initState();
    await initPowerUps();
    await initLeaderboard();
    logDev('✅ Game systems initialized');
    
    // Initialize UI with event handlers
    await initUI({
      onSlap: handleSlap,
      onPowerUpActivate: handlePowerUpActivate,
      onDailyRewardClaim: handleDailyRewardClaim,
      onSoundToggle: handleSoundToggle,
      onShare: handleShare,
      onRefreshLeaderboard: handleRefreshLeaderboard
    });
    
    // Set up event listeners
    setupEventListeners();
    
    // Set up periodic tasks
    setupPeriodicTasks();
    
    // Set up theme
    const theme = getTheme();
    updateTheme(theme);
    
    // Check for first-time user
    const user = getUser();
    const state = getState();
    
    if (!state || state.totalSlaps === 0) {
      // First time user - show onboarding
      setTimeout(() => showOnboarding(), 1000);
      logInfo('👋 New user detected - showing onboarding');
    } else {
      // Returning user
      announce(t('messages.welcome'));
      logInfo('🎮 Returning user - welcome back!');
    }
    
    // Start background music if enabled and not muted
    if (APP_CONFIG.features.backgroundMusic) {
      setTimeout(() => startBackgroundMusic(), 2000);
    }
    
    // Start game loop
    startGameLoop();
    
    // Run tests in development
    if (APP_CONFIG.debug) {
      setTimeout(() => runUnitTests(), 5000);
    }
    
    // Initialize PWA features
    if ('serviceWorker' in navigator) {
      initializePWA();
    }

    // Set up Telegram lifecycle hooks
    onReady(() => {
      announce(t('game.ready'));
      logInfo('📱 Telegram ready event received');
    });

    onClose(() => {
      announce(t('messages.shareScore', { score: getState().score }));
      logInfo('👋 App closing');
      saveGameProgress();
      cleanup();
    });

    // Hide loading screen
    clearTimeout(loadingTimeout);
    hideLoadingScreen();
    
    appInitialized = true;
    
    // Calculate and log performance metrics
    performanceMetrics.loadTime = performance.now() - startTime;
    logInfo(`🎉 Application fully initialized in ${performanceMetrics.loadTime.toFixed(2)}ms`);

    // Show success notification
    setTimeout(() => {
      showToast(t('success.connected'), 'success');
    }, 1000);

  } catch (error) {
    logError('💥 Application initialization failed:', error);
    hideLoadingScreen();
    showError(t('errors.initializationFailed', { error: error.message }));
    
    // Fallback error UI
    showFallbackError(error);
  }
}

/**
 * Handle slap button interaction
 */
async function handleSlap() {
  try {
    if (!appInitialized) return;

    const prevState = getState();
    const points = await slap();
    const newState = getState();

    if (!points) return; // Anti-cheat blocked

    // Visual feedback
    if (APP_CONFIG.features.animations) {
      queueAnimation(() => triggerSlapAnimation(points), 'high');
    }

    // Audio feedback
    if (APP_CONFIG.features.audio) {
      playHitSound();
      
      // Special audio for combos
      if (newState.combo > prevState.combo && newState.combo > 1) {
        playComboSound(newState.combo);
        
        if (APP_CONFIG.features.animations) {
          queueAnimation(() => triggerComboAnimation(newState.combo), 'high');
        }
      }
      
      // Achievement sound
      if (newState.achievements.length > prevState.achievements.length) {
        playAchievementSound();
        
        if (APP_CONFIG.features.animations) {
          const newAchievement = newState.achievements[newState.achievements.length - 1];
          queueAnimation(() => triggerAchievementAnimation(newAchievement), 'high');
        }
      }
    }

    // Haptic feedback
    if (APP_CONFIG.features.hapticFeedback) {
      if (isInsideTelegram()) {
        let intensity = 'light';
        if (newState.combo > 10) intensity = 'medium';
        if (newState.combo > 25) intensity = 'heavy';
        
        hapticFeedback('impact', intensity);
      } else if (navigator.vibrate) {
        const duration = Math.min(50 + newState.combo * 2, 200);
        navigator.vibrate(duration);
      }
    }

    // Update leaderboard
    updateLeaderboard(newState.score);
    
    // Check for notifications
    checkForNotifications(prevState, newState);

  } catch (error) {
    logError('Error handling slap:', error);
    showError(error.message || t('errors.general'));
  }
}

/**
 * Handle power-up activation
 */
async function handlePowerUpActivate(powerUpId) {
  try {
    const powerUpElement = document.querySelector(`[data-powerup="${powerUpId}"]`);
    
    await activatePowerUp(powerUpId);
    
    // Visual and audio feedback
    if (APP_CONFIG.features.animations && powerUpElement) {
      queueAnimation(() => triggerPowerUpAnimation(powerUpId, powerUpElement), 'normal');
    }
    
    if (APP_CONFIG.features.audio) {
      playPowerUpSound();
    }
    
    // Haptic feedback
    if (APP_CONFIG.features.hapticFeedback && isInsideTelegram()) {
      hapticFeedback('notification', 'success');
    }
    
    showToast(t('messages.powerUpActivated', { 
      powerup: t(`powerups.${powerUpId}.name`) 
    }), 'success');
    
    logDev(`Power-up activated: ${powerUpId}`);

  } catch (error) {
    logError('Error activating power-up:', error);
    showError(t('errors.powerUpError', { error: error.message }));
  }
}

/**
 * Handle daily reward claim
 */
async function handleDailyRewardClaim() {
  try {
    const reward = await claimDailyReward();
    
    // Visual feedback
    showToast(t('messages.dailyRewardClaimed', { points: reward }), 'success');
    
    // Audio feedback
    if (APP_CONFIG.features.audio) {
      playSuccessSound();
    }
    
    // Haptic feedback
    if (APP_CONFIG.features.hapticFeedback && isInsideTelegram()) {
      hapticFeedback('notification', 'success');
    }
    
    logInfo(`Daily reward claimed: ${reward} points`);

  } catch (error) {
    logError('Error claiming daily reward:', error);
    showError(error.message || t('errors.general'));
  }
}

/**
 * Handle sound toggle
 */
function handleSoundToggle() {
  try {
    const wasMuted = toggleMute();
    
    showToast(
      wasMuted ? 'Sound muted' : 'Sound enabled', 
      'info', 
      1500
    );
    
    // Test sound if unmuted
    if (!wasMuted && APP_CONFIG.features.audio) {
      setTimeout(() => playNotificationSound(), 200);
    }
    
    logDev(`Sound ${wasMuted ? 'muted' : 'enabled'}`);

  } catch (error) {
    logError('Error toggling sound:', error);
  }
}

/**
 * Handle score sharing
 */
function handleShare(score) {
  try {
    if (isInsideTelegram()) {
      shareScore(score);
    } else {
      // Fallback sharing
      const shareData = {
        title: t('social.shareTitle'),
        text: t('social.shareText', { score: formatNumber(score) }),
        url: window.location.href
      };
      
      if (navigator.share && navigator.canShare(shareData)) {
        navigator.share(shareData);
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
        showToast('Share text copied to clipboard!', 'success');
      }
    }
    
    logDev(`Score shared: ${score}`);

  } catch (error) {
    logError('Error sharing score:', error);
    showError(t('errors.general'));
  }
}

/**
 * Handle leaderboard refresh
 */
async function handleRefreshLeaderboard() {
  try {
    const refreshBtn = document.getElementById('refresh-leaderboard');
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.classList.add('spinning');
    }
    
    await refreshLeaderboard();
    
    showToast('Leaderboard refreshed!', 'success', 2000);
    
  } catch (error) {
    logError('Error refreshing leaderboard:', error);
    showError(t('errors.leaderboardError'));
  } finally {
    const refreshBtn = document.getElementById('refresh-leaderboard');
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('spinning');
    }
  }
}

/**
 * Set up global event listeners
 */
function setupEventListeners() {
  // State change listeners
  onStateChange((state) => {
    updateUI();
    
    // Auto-save periodically
    if (state.totalSlaps % 50 === 0) {
      saveGameProgress();
    }
  });
  
  onPowerUpChange((powerUps) => {
    updateUI();
  });
  
  onLeaderboardChange((leaderboard) => {
    updateUI();
  });
  
  // Theme change listener
  onThemeChanged((theme) => {
    updateTheme(theme);
    logDev(`Theme changed to: ${theme}`);
  });
  
  // Network status listeners
  window.addEventListener('online', () => {
    logInfo('🌐 Connection restored');
    showToast(t('success.connected'), 'success', 2000);
    
    // Resume background sync
    const syncQueue = JSON.parse(localStorage.getItem('ngs_sync_queue_v2') || '[]');
    if (syncQueue.length > 0) {
      logInfo(`Resuming sync of ${syncQueue.length} items`);
    }
  });
  
  window.addEventListener('offline', () => {
    logInfo('📡 Connection lost - offline mode');
    showToast(t('errors.offline'), 'info', 3000);
  });
  
  // Page visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Page hidden - save progress
      saveGameProgress();
    } else {
      // Page visible - refresh data
      if (getOnlineStatus()) {
        setTimeout(() => refreshLeaderboard().catch(() => {}), 1000);
      }
    }
  });
  
  // Error handling
  window.addEventListener('error', (event) => {
    logError('Unhandled error:', event.error);
  });
  
  window.addEventListener('unhandledrejection', (event) => {
    logError('Unhandled promise rejection:', event.reason);
  });
  
  // Performance monitoring
  if (APP_CONFIG.debug) {
    setInterval(() => {
      logDev('Performance metrics:', performanceMetrics);
    }, 10000);
  }
}

/**
 * Set up periodic background tasks
 */
function setupPeriodicTasks() {
  // Auto-save
  setInterval(() => {
    if (appInitialized) {
      saveGameProgress();
    }
  }, APP_CONFIG.game.autoSaveInterval);
  
  // Leaderboard refresh
  setInterval(() => {
    if (appInitialized && getOnlineStatus()) {
      refreshLeaderboard().catch(error => {
        logError('Background leaderboard refresh failed:', error);
      });
    }
  }, APP_CONFIG.game.leaderboardRefreshInterval);
  
  // Cleanup old data
  setInterval(() => {
    if (appInitialized) {
      cleanupOldData();
    }
  }, 24 * 60 * 60 * 1000); // Daily cleanup
}

/**
 * Start game loop for performance monitoring
 */
function startGameLoop() {
  let frameCount = 0;
  let lastFPSUpdate = performance.now();
  
  function gameLoop(currentTime) {
    const deltaTime = currentTime - lastFrameTime;
    lastFrameTime = currentTime;
    
    // Update performance metrics
    performanceMetrics.frameTime = deltaTime;
    frameCount++;
    
    if (currentTime - lastFPSUpdate >= 1000) {
      performanceMetrics.fps = Math.round((frameCount * 1000) / (currentTime - lastFPSUpdate));
      frameCount = 0;
      lastFPSUpdate = currentTime;
    }
    
    // Continue loop
    gameLoopId = requestAnimationFrame(gameLoop);
  }
  
  gameLoopId = requestAnimationFrame(gameLoop);
}

/**
 * Stop game loop
 */
function stopGameLoop() {
  if (gameLoopId) {
    cancelAnimationFrame(gameLoopId);
    gameLoopId = null;
  }
}

/**
 * Check for notifications and achievements
 */
function checkForNotifications(prevState, newState) {
  // High score notification
  if (newState.score > (prevState.statistics?.highestScore || 0)) {
    showToast(t('messages.highScore', { score: formatNumber(newState.score) }), 'success');
  }
  
  // Level up notification
  const prevLevel = Math.floor(prevState.score / 1000);
  const newLevel = Math.floor(newState.score / 1000);
  if (newLevel > prevLevel) {
    showToast(t('messages.levelUp', { level: newLevel + 1 }), 'success');
    
    if (APP_CONFIG.features.audio) {
      playSuccessSound();
    }
  }
  
  // Combo milestone notifications
  if (newState.combo > prevState.combo) {
    if (newState.combo === 10 || newState.combo === 25 || newState.combo === 50) {
      showToast(`🔥 ${newState.combo}x Combo!`, 'success');
    }
  }
  
  // Power-up unlock notifications
  const powerUps = getPowerUpsState();
  Object.entries(powerUps).forEach(([id, powerUp]) => {
    if (powerUp.unlocked && newState.score >= powerUp.unlockThreshold && 
        prevState.score < powerUp.unlockThreshold) {
      showToast(t('messages.powerUpUnlocked', { 
        powerup: t(`powerups.${id}.name`) 
      }), 'success');
    }
  });
}

/**
 * Save game progress
 */
async function saveGameProgress() {
  try {
    // This is handled automatically by the state module
    // Just enqueue a sync operation if online
    if (getOnlineStatus()) {
      const state = getState();
      enqueueSync({
        type: 'user_progress',
        data: {
          score: state.score,
          totalSlaps: state.totalSlaps,
          timestamp: Date.now()
        },
        priority: 'normal'
      });
    }
  } catch (error) {
    logError('Error saving game progress:', error);
  }
}

/**
 * Cleanup old data
 */
function cleanupOldData() {
  try {
    // Clear old cache entries
    const keys = Object.keys(localStorage);
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    let cleaned = 0;
    keys.forEach(key => {
      if (key.startsWith('ngs_') && key.includes('cache')) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (data && data.timestamp && (now - data.timestamp) > maxAge) {
            localStorage.removeItem(key);
            cleaned++;
          }
        } catch (e) {
          // Invalid data, remove it
          localStorage.removeItem(key);
          cleaned++;
        }
      }
    });
    
    if (cleaned > 0) {
      logDev(`Cleaned up ${cleaned} old cache entries`);
    }
  } catch (error) {
    logError('Error cleaning up old data:', error);
  }
}

/**
 * Initialize PWA features
 */
function initializePWA() {
  // Register service worker for offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      logDev('Service Worker registered:', registration);
    }).catch(error => {
      logError('Service Worker registration failed:', error);
    });
  }
  
  // Handle PWA install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    
    // Show custom install prompt
    const installBtn = document.createElement('button');
    installBtn.textContent = 'Install App';
    installBtn.className = 'install-prompt';
    installBtn.onclick = () => {
      e.prompt();
      installBtn.remove();
    };
    
    document.body.appendChild(installBtn);
  });
}

/**
 * Show fallback error UI
 */
function showFallbackError(error) {
  const fallbackHTML = `
    <div class="fallback-error">
      <h1>😅 Oops!</h1>
      <p>Something went wrong loading the game.</p>
      <p><small>${error.message}</small></p>
      <button onclick="window.location.reload()">Try Again</button>
    </div>
  `;
  
  document.body.innerHTML = fallbackHTML;
}

/**
 * Cleanup resources
 */
function cleanup() {
  stopGameLoop();
  saveGameProgress();
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  // DOM is already ready
  setTimeout(initApp, 0);
}

// Global error handlers
window.addEventListener('error', (event) => {
  logError('Global error:', event.error);
  if (appInitialized) {
    showError(t('errors.general'));
  }
});

window.addEventListener('unhandledrejection', (event) => {
  logError('Unhandled promise rejection:', event.reason);
  if (appInitialized) {
    showError(t('errors.general'));
  }
});

// Export for debugging and testing
if (APP_CONFIG.debug) {
  window.NoGasSlaps = {
    getState,
    handleSlap,
    performanceMetrics,
    appInitialized,
    APP_CONFIG,
    cleanup
  };
}

// Version info
console.log(`🚀 No_Gas_Slaps™ v${APP_CONFIG.version} - Production Ready`);

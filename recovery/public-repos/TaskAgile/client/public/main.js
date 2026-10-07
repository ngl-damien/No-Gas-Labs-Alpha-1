/**
 * No_Gas_Slaps™ - Main Application Entry Point
 * Production-ready Telegram Mini App for tap-to-earn gaming
 * 
 * @author No_Gas_Slaps™ Development Team
 * @version 1.0.0
 * @license MIT
 */

// Import all game modules
import { initTelegram, getTheme, onThemeChanged, getUser, onReady, onClose, isInsideTelegram } from './modules/telegram-api.js';
import { initUI, updateUI, announce, focusSlapButton, showOnboarding, hideOnboarding, showHelp } from './modules/ui.js';
import { initState, getState, onStateChange, slap, initPowerUps, claimDailyReward, onPowerUpChange, activatePowerUp } from './modules/state.js';
import { syncLeaderboard, getLeaderboard, onLeaderboardChange, updateLeaderboard, refreshLeaderboard } from './modules/leaderboard-api.js';
import { showError, clearError, showSuccess, onErrorChange } from './modules/error.js';
import { verifyInitData, sanitizeInput } from './modules/security.js';
import { initPersistence, onSyncQueueChange } from './modules/persistence.js';
import { runUnitTests, logDev, logError, logInfo } from './modules/testing.js';
import { initAudio, playHitSound, playSuccessSound, playComboSound, toggleMute } from './modules/audio.js';
import { initAnimations, triggerSlapAnimation, triggerComboAnimation, triggerPowerUpAnimation } from './modules/animations.js';
import { initMultiplayer, sendSlap, sendMovement, getMultiplayerState, updateProfile } from './modules/multiplayer.js';
import { loadLocalization, t } from './localization/en.js';

/**
 * Application configuration
 */
const APP_CONFIG = {
  version: '1.0.0',
  environment: 'production',
  debug: false,
  features: {
    audio: true,
    animations: true,
    hapticFeedback: true,
    pwa: true,
    accessibility: true
  }
};

/**
 * Application state management
 */
let appInitialized = false;
let loadingTimeout = null;

/**
 * Initialize the application
 */
async function initializeApp() {
  try {
    logInfo('🚀 Initializing No_Gas_Slaps™ Application');

    // Set loading timeout to prevent indefinite loading
    loadingTimeout = setTimeout(() => {
      hideLoadingScreen();
      showError(t('errors.loadingTimeout'));
    }, 15000);

    // Load localization first
    await loadLocalization();
    logInfo('✅ Localization loaded');

    // Initialize Telegram SDK
    await initTelegram();
    logInfo('✅ Telegram SDK initialized');

    // Verify init data for security
    if (isInsideTelegram()) {
      verifyInitData();
      logInfo('✅ Telegram init data verified');
    } else {
      logInfo('⚠️ Running outside Telegram - some features may be limited');
    }

    // Apply theme from Telegram
    const theme = getTheme();
    document.body.setAttribute('data-theme', theme);
    logInfo(`✅ Theme applied: ${theme}`);

    // Listen for theme changes
    onThemeChanged(newTheme => {
      document.body.setAttribute('data-theme', newTheme);
      logInfo(`🎨 Theme changed to: ${newTheme}`);
      announce(t('announcements.themeChanged', { theme: newTheme }));
    });

    // Initialize persistence layer
    await initPersistence();
    logInfo('✅ Persistence initialized');

    // Initialize audio system
    if (APP_CONFIG.features.audio) {
      await initAudio();
      logInfo('✅ Audio system initialized');
    }

    // Initialize animations
    if (APP_CONFIG.features.animations) {
      initAnimations();
      logInfo('✅ Animation system initialized');
    }

    // Initialize game state
    await initState();
    logInfo('✅ Game state initialized');

    // Initialize power-ups
    await initPowerUps();
    logInfo('✅ Power-ups initialized');

    // Initialize multiplayer system
    try {
      await initMultiplayer();
      logInfo('✅ Multiplayer initialized');

      // Set up multiplayer event listeners
      window.addEventListener('ngs:multiplayer:update', handleMultiplayerUpdate);

      // Update profile with Telegram user info
      const user = getUser();
      if (user?.first_name) {
        updateProfile(user.first_name);
      }

    } catch (error) {
      logInfo('⚠️ Multiplayer not available - running in single player mode');
      // Continue without multiplayer
    }

    // Initialize UI components
    initUI({
      onSlap: handleSlap,
      onClaimDaily: handleClaimDaily,
      onActivatePowerUp: handleActivatePowerUp,
      onRefreshLeaderboard: handleRefreshLeaderboard,
      onShowHelp: () => showHelp(),
      onToggleMute: toggleMute,
      onShare: handleShare
    });
    logInfo('✅ UI initialized');

    // Set up reactive updates
    onStateChange(handleStateChange);
    onPowerUpChange(updateUI);
    onLeaderboardChange(updateUI);
    onErrorChange(updateUI);

    // Initialize leaderboard sync
    onSyncQueueChange(syncLeaderboard);

    // Run development tests
    if (APP_CONFIG.debug || window.location.hostname === 'localhost') {
      runUnitTests();
      logInfo('✅ Unit tests executed');
    }

    // Check for first-time user
    const hasSeenOnboarding = localStorage.getItem('ngs_onboarded');
    if (!hasSeenOnboarding) {
      showOnboardingFlow();
    } else {
      // Focus slap button for immediate interaction
      setTimeout(focusSlapButton, 500);
    }

    // Initialize PWA features
    if (APP_CONFIG.features.pwa) {
      initializePWA();
    }

    // Set up Telegram lifecycle hooks
    onReady(() => {
      announce(t('announcements.gameReady'));
      logInfo('📱 Telegram ready event received');
    });

    onClose(() => {
      announce(t('announcements.appClosed'));
      logInfo('👋 App closing');
      saveGameState();
    });

    // Hide loading screen
    clearTimeout(loadingTimeout);
    hideLoadingScreen();

    appInitialized = true;
    logInfo('🎉 Application fully initialized');

  } catch (error) {
    logError('💥 Application initialization failed:', error);
    clearTimeout(loadingTimeout);
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

    const multiplayerState = getMultiplayerState();
    const prevState = getState();

    // Handle multiplayer slap
    if (multiplayerState.connected) {
      const slapSent = sendSlap();
      if (!slapSent) {
        showError('Not enough gas to slap!');
        return;
      }
    } else {
      // Single player mode
      await slap();
    }

    const newState = getState();

    // Visual feedback
    if (APP_CONFIG.features.animations) {
      triggerSlapAnimation();
    }

    // Audio feedback
    if (APP_CONFIG.features.audio) {
      playHitSound();

      // Special audio for combos
      if (newState.combo > prevState.combo && newState.combo > 1) {
        playComboSound(newState.combo);
      }
    }

    // Haptic feedback
    if (APP_CONFIG.features.hapticFeedback && navigator.vibrate) {
      navigator.vibrate([10, 5, 15]);
    }

    // Update leaderboard if score changed significantly
    if (newState.score > prevState.score) {
      updateLeaderboard(newState.score);
    }

    // Announce score milestone
    if (newState.score % 1000 === 0 && newState.score > 0) {
      announce(t('announcements.scoreMilestone', { score: newState.score }));
      if (APP_CONFIG.features.audio) {
        playSuccessSound();
      }
    }

  } catch (error) {
    logError('Error handling slap:', error);
    showError(error.message || t('errors.slapFailed'));
  }
}

/**
 * Handle daily reward claim
 */
async function handleClaimDaily() {
  try {
    const prevState = getState();
    await claimDailyReward();
    const newState = getState();

    // Success feedback
    if (APP_CONFIG.features.audio) {
      playSuccessSound();
    }

    showSuccess(t('success.dailyRewardClaimed', { 
      amount: newState.score - prevState.score 
    }));

    // Update leaderboard
    updateLeaderboard(newState.score);

    // Announce achievement
    announce(t('announcements.dailyRewardClaimed'));

  } catch (error) {
    logError('Error claiming daily reward:', error);
    showError(error.message || t('errors.claimFailed'));
  }
}

/**
 * Handle power-up activation
 */
async function handleActivatePowerUp(powerUpId) {
  try {
    await activatePowerUp(powerUpId);

    // Visual feedback
    if (APP_CONFIG.features.animations) {
      triggerPowerUpAnimation(powerUpId);
    }

    // Audio feedback
    if (APP_CONFIG.features.audio) {
      playSuccessSound();
    }

    showSuccess(t('success.powerUpActivated', { powerUp: powerUpId }));
    announce(t('announcements.powerUpActivated', { powerUp: powerUpId }));

  } catch (error) {
    logError('Error activating power-up:', error);
    showError(error.message || t('errors.powerUpFailed'));
  }
}

/**
 * Handle leaderboard refresh
 */
async function handleRefreshLeaderboard() {
  try {
    await refreshLeaderboard();
    announce(t('announcements.leaderboardRefreshed'));
  } catch (error) {
    logError('Error refreshing leaderboard:', error);
    showError(error.message || t('errors.leaderboardRefreshFailed'));
  }
}

/**
 * Handle state changes
 */
function handleStateChange(newState) {
  updateUI();

  // Save state periodically
  if (newState.score % 50 === 0) {
    saveGameState();
  }

  // Trigger animations for combo changes
  if (APP_CONFIG.features.animations && newState.combo > 1) {
    triggerComboAnimation(newState.combo);
  }
}

/**
 * Handle multiplayer events
 */
function handleMultiplayerUpdate(event) {
  const { type, data, players, playerId } = event.detail;

  switch (type) {
    case 'playerHit':
      if (data.id === playerId) {
        // We got hit - show screen shake effect
        document.body.style.animation = 'shake 0.3s ease-in-out';
        setTimeout(() => {
          document.body.style.animation = '';
        }, 300);
      }
      break;

    case 'playerDied':
      if (data.killerId === playerId) {
        // We eliminated someone - show celebration
        showSuccess(`Eliminated Player ${data.id}! +200 points`);
      }
      break;
  }

  // Update UI with current multiplayer state
  updateUI();
}

/**
 * Handle sharing functionality
 */
function handleShare() {
  try {
    const state = getState();
    const user = getUser();
    const shareText = t('share.message', {
      score: state.score,
      name: user?.first_name || 'Player'
    });

    if (navigator.share) {
      navigator.share({
        title: t('share.title'),
        text: shareText,
        url: window.location.href
      });
    } else {
      // Fallback to clipboard
      navigator.clipboard.writeText(shareText).then(() => {
        showSuccess(t('success.shareTextCopied'));
      });
    }

    announce(t('announcements.shareTriggered'));

  } catch (error) {
    logError('Error sharing:', error);
    showError(t('errors.shareFailed'));
  }
}

/**
 * Show onboarding flow for new users
 */
function showOnboardingFlow() {
  showOnboarding(() => {
    localStorage.setItem('ngs_onboarded', 'true');
    hideOnboarding();

    // Welcome message for new users
    setTimeout(() => {
      showSuccess(t('success.welcomeMessage'));
      announce(t('announcements.onboardingComplete'));
      focusSlapButton();
    }, 500);
  });
}

/**
 * Initialize PWA features
 */
function initializePWA() {
  let deferredPrompt = null;

  // Listen for install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showPWAInstallPrompt();
  });

  // Handle install prompt
  function showPWAInstallPrompt() {
    const installEl = document.getElementById('pwa-install');
    const installBtn = document.getElementById('pwa-install-btn');
    const dismissBtn = document.getElementById('pwa-dismiss');

    if (installEl && deferredPrompt) {
      installEl.classList.remove('hidden');
      installEl.classList.add('show');

      installBtn?.addEventListener('click', async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;

          if (outcome === 'accepted') {
            logInfo('PWA install accepted');
            showSuccess(t('success.pwaInstalled'));
          }

          deferredPrompt = null;
          hidePWAInstallPrompt();
        }
      });

      dismissBtn?.addEventListener('click', () => {
        hidePWAInstallPrompt();
        localStorage.setItem('ngs_pwa_dismissed', Date.now().toString());
      });
    }
  }

  function hidePWAInstallPrompt() {
    const installEl = document.getElementById('pwa-install');
    if (installEl) {
      installEl.classList.remove('show');
      installEl.classList.add('hidden');
    }
  }

  // Check if already dismissed recently
  const lastDismissed = localStorage.getItem('ngs_pwa_dismissed');
  if (lastDismissed) {
    const dismissedTime = parseInt(lastDismissed);
    const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
    if (daysSinceDismissed < 7) return; // Don't show for a week
  }
}

/**
 * Hide loading screen with animation
 */
function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.add('fade-out');
    setTimeout(() => {
      loadingScreen.style.display = 'none';
    }, 400);
  }
}

/**
 * Save current game state
 */
function saveGameState() {
  try {
    const state = getState();
    const saveData = {
      score: state.score,
      combo: state.combo,
      powerUps: state.powerUps,
      dailyClaimed: state.dailyClaimed,
      lastSaved: Date.now()
    };

    localStorage.setItem('ngs_game_state', JSON.stringify(saveData));
    logDev('Game state saved');
  } catch (error) {
    logError('Failed to save game state:', error);
  }
}

/**
 * Show fallback error UI
 */
function showFallbackError(error) {
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.innerHTML = `
      <div class="error-container" role="alert">
        <div class="error-icon">⚠️</div>
        <h1>No_Gas_Slaps™</h1>
        <p>Something went wrong while loading the game.</p>
        <details>
          <summary>Error Details</summary>
          <pre>${sanitizeInput(error.message || 'Unknown error')}</pre>
        </details>
        <button onclick="window.location.reload()" class="btn btn-primary">
          Reload Game
        </button>
      </div>
    `;
  }
}

/**
 * Handle global errors
 */
window.addEventListener('error', (event) => {
  logError('Global error:', event.error);
  if (!appInitialized) {
    showFallbackError(event.error);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  logError('Unhandled promise rejection:', event.reason);
  if (!appInitialized) {
    showFallbackError(new Error(event.reason));
  }
});

/**
 * Handle page visibility changes
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    saveGameState();
    logDev('Page hidden - game state saved');
  } else {
    logDev('Page visible - resuming game');
    if (appInitialized) {
      updateUI();
    }
  }
});

/**
 * Handle page unload
 */
window.addEventListener('beforeunload', () => {
  saveGameState();
  logInfo('Page unloading - final save completed');
});

/**
 * Performance monitoring
 */
if ('PerformanceObserver' in window) {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'measure') {
        logDev(`Performance: ${entry.name} took ${entry.duration.toFixed(2)}ms`);
      }
    }
  });

  observer.observe({ entryTypes: ['measure'] });
}

/**
 * Initialize application when DOM is ready
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

/**
 * Export for debugging in development
 */
if (APP_CONFIG.debug || window.location.hostname === 'localhost') {
  window.NoGasSlaps = {
    getState,
    slap: handleSlap,
    showError,
    showSuccess,
    config: APP_CONFIG,
    version: APP_CONFIG.version
  };

  logInfo('🔧 Debug interface attached to window.NoGasSlaps');
}

// Placeholder for announceToScreenReader, assuming it's defined elsewhere or will be implemented
function announceToScreenReader(message) {
  // This function is called in initGame, but not defined in the provided code.
  // Assuming it's meant for accessibility announcements.
  console.log(`[Screen Reader Announcement]: ${message}`);
}

/**
 * Initialize the game
 */
async function initGame() {
  try {
    announceToScreenReader('Initializing No_Gas_Slaps™ game...');

    // Check for Phaser 3 mode (can be toggled via URL parameter)
    const urlParams = new URLSearchParams(window.location.search);
    const usePhaserMode = urlParams.get('phaser') === 'true';

    if (usePhaserMode) {
      // Load Phaser 3 version
      const { initPhaserGame } = await import('../phaser-game.js');
      initPhaserGame();
      return;
    }

    // Continue with the existing game initialization if not in Phaser mode
    await initializeApp();

  } catch (error) {
    logError('💥 Game initialization failed:', error);
    // Handle game initialization errors, possibly showing a fallback UI
    showFallbackError(error);
  }
}
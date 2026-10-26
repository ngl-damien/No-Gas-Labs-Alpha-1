
/**
 * UI Module - Handles all user interface interactions and updates
 * Implements WCAG 2.1 AA accessibility standards
 */

import { getState } from './state.js';
import { getLeaderboard } from './leaderboard-api.js';
import { getUser, hapticFeedback, isInsideTelegram } from './telegram-api.js';
import { getError, getCurrentSuccess } from './error.js';
import { t } from '../localization/en.js';

// UI Element References
let appEl, slapBtn, scoreEl, comboEl, leaderboardList, powerupsGrid;
let onboardingOverlay, helpOverlay, errorToast, successToast;
let gameHeader, dailyRewardSection, progressBar, rankDisplay;

// UI State
let lastScore = 0;
let lastCombo = 0;
let animationTimeouts = new Set();
let currentTheme = 'light';

// Event Handlers
let eventHandlers = {};

/**
 * Initialize UI components and event listeners
 */
export function initUI(handlers) {
  eventHandlers = handlers;
  
  // Get main app container
  appEl = document.getElementById('app');
  if (!appEl) {
    throw new Error('App container not found');
  }

  // Create main UI structure
  createMainUI();
  
  // Get UI element references
  cacheUIElements();
  
  // Set up event listeners
  setupEventListeners();
  
  // Set up accessibility features
  setupAccessibility();
  
  // Initial UI update
  updateUI();
  
  console.log('✅ UI initialized successfully');
}

/**
 * Create the main UI structure
 */
function createMainUI() {
  appEl.innerHTML = `
    <!-- Loading Screen -->
    <div id="loading-screen" class="loading-screen">
      <div class="loading-logo">
        <svg width="80" height="80" viewBox="0 0 100 100" class="logo-animation">
          <circle cx="50" cy="50" r="40" stroke="var(--neon-green)" stroke-width="8" fill="none" 
                  stroke-linecap="round" stroke-dasharray="251" stroke-dashoffset="251" class="loading-circle"/>
        </svg>
      </div>
      <div class="loading-text">Loading No_Gas_Slaps™...</div>
    </div>

    <!-- Main Game Container -->
    <div class="app-container" style="display: none;">
      <!-- Game Header -->
      <header class="game-header">
        <div class="header-left">
          <h1 class="game-title">No_Gas_Slaps™</h1>
          <div class="user-info">
            <span id="user-name" class="user-name"></span>
            <span id="user-rank" class="user-rank"></span>
          </div>
        </div>
        <div class="header-actions">
          <button id="help-btn" class="icon-btn" aria-label="Help">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
            </svg>
          </button>
          <button id="sound-btn" class="icon-btn" aria-label="Toggle Sound">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          </button>
        </div>
      </header>

      <!-- Score Section -->
      <section class="score-section">
        <div class="score-display">
          <div class="score-value" id="score">0</div>
          <div class="score-label">Points</div>
        </div>
        <div class="combo-display">
          <div class="combo-value" id="combo">1x</div>
          <div class="combo-label">Combo</div>
        </div>
      </section>

      <!-- Progress Bar -->
      <div class="progress-container">
        <div class="progress-bar">
          <div id="progress-fill" class="progress-fill" style="width: 0%"></div>
        </div>
        <div class="progress-text">
          <span id="current-level">Level 1</span>
          <span id="next-milestone">Next: 100 pts</span>
        </div>
      </div>

      <!-- Main Slap Button -->
      <div class="slap-container">
        <button id="slap-btn" class="slap-button" aria-label="Tap to slap and earn points">
          <div class="slap-button-inner">
            <div class="slap-emoji">👋</div>
            <div class="slap-text">SLAP!</div>
          </div>
          <div class="slap-button-glow"></div>
        </button>
      </div>

      <!-- Power-ups Grid -->
      <section class="powerups-section">
        <h2 class="section-title">Power-ups</h2>
        <div id="powerups-grid" class="powerups-grid">
          <div class="powerup-card locked" data-powerup="doublePoints">
            <div class="powerup-icon">⚡</div>
            <div class="powerup-name">Double Points</div>
            <div class="powerup-description">2x points for 30s</div>
            <div class="powerup-status">Unlock at 500 pts</div>
          </div>
          <div class="powerup-card locked" data-powerup="rapidFire">
            <div class="powerup-icon">🚀</div>
            <div class="powerup-name">Rapid Fire</div>
            <div class="powerup-description">Faster tapping</div>
            <div class="powerup-status">Unlock at 1000 pts</div>
          </div>
          <div class="powerup-card locked" data-powerup="shield">
            <div class="powerup-icon">🛡️</div>
            <div class="powerup-name">Combo Shield</div>
            <div class="powerup-description">Protect combo</div>
            <div class="powerup-status">Unlock at 2000 pts</div>
          </div>
          <div class="powerup-card locked" data-powerup="magnet">
            <div class="powerup-icon">🧲</div>
            <div class="powerup-name">Point Magnet</div>
            <div class="powerup-description">Auto-collect bonuses</div>
            <div class="powerup-status">Unlock at 5000 pts</div>
          </div>
          <div class="powerup-card locked" data-powerup="boost">
            <div class="powerup-icon">💥</div>
            <div class="powerup-name">Mega Boost</div>
            <div class="powerup-description">3x multiplier</div>
            <div class="powerup-status">Unlock at 10000 pts</div>
          </div>
        </div>
      </section>

      <!-- Daily Reward Section -->
      <section id="daily-reward" class="daily-reward-section">
        <div class="daily-reward-card">
          <div class="reward-icon">🎁</div>
          <div class="reward-content">
            <h3>Daily Reward</h3>
            <p>Come back every day for bonus points!</p>
            <button id="claim-daily" class="claim-btn">Claim 100 pts</button>
          </div>
        </div>
      </section>

      <!-- Leaderboard Section -->
      <section class="leaderboard-section">
        <div class="section-header">
          <h2 class="section-title">🏆 Leaderboard</h2>
          <button id="refresh-leaderboard" class="refresh-btn" aria-label="Refresh leaderboard">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </button>
        </div>
        <div id="leaderboard-list" class="leaderboard-list">
          <div class="leaderboard-item skeleton">
            <div class="rank-badge"></div>
            <div class="player-info">
              <div class="player-name"></div>
              <div class="player-score"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- Share Button -->
      <div class="share-section">
        <button id="share-btn" class="share-button">
          <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
            <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
          </svg>
          Share Score
        </button>
      </div>
    </div>

    <!-- Onboarding Overlay -->
    <div id="onboarding-overlay" class="overlay onboarding-overlay">
      <div class="overlay-content">
        <h2>Welcome to No_Gas_Slaps™!</h2>
        <div class="onboarding-steps">
          <div class="onboarding-step">
            <div class="step-icon">👋</div>
            <h3>Tap to Slap</h3>
            <p>Tap the slap button to earn points and build combos</p>
          </div>
          <div class="onboarding-step">
            <div class="step-icon">⚡</div>
            <h3>Unlock Power-ups</h3>
            <p>Reach milestones to unlock powerful abilities</p>
          </div>
          <div class="onboarding-step">
            <div class="step-icon">🏆</div>
            <h3>Compete</h3>
            <p>Climb the leaderboard and share your achievements</p>
          </div>
        </div>
        <button id="start-game" class="primary-btn">Start Slapping!</button>
      </div>
    </div>

    <!-- Help Overlay -->
    <div id="help-overlay" class="overlay help-overlay hidden">
      <div class="overlay-content">
        <h2>How to Play</h2>
        <div class="help-content">
          <div class="help-section">
            <h3>🎯 Basic Gameplay</h3>
            <p>Tap the slap button to earn points. Build combos by tapping quickly!</p>
          </div>
          <div class="help-section">
            <h3>⚡ Power-ups</h3>
            <p>Unlock special abilities by reaching point milestones. Each power-up has a cooldown period.</p>
          </div>
          <div class="help-section">
            <h3>🏆 Leaderboard</h3>
            <p>Compete with other players and climb to the top of the rankings!</p>
          </div>
          <div class="help-section">
            <h3>🎁 Daily Rewards</h3>
            <p>Come back daily to claim bonus points and maintain your streak.</p>
          </div>
        </div>
        <button id="close-help" class="primary-btn">Got It!</button>
      </div>
    </div>

    <!-- Toast Notifications -->
    <div id="error-toast" class="toast toast-error hidden" role="alert">
      <div class="toast-content">
        <svg class="toast-icon" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        <span class="toast-message"></span>
      </div>
    </div>

    <div id="success-toast" class="toast toast-success hidden" role="alert">
      <div class="toast-content">
        <svg class="toast-icon" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        <span class="toast-message"></span>
      </div>
    </div>

    <!-- Floating Point Animations Container -->
    <div id="floating-points" class="floating-points"></div>
  `;
}

/**
 * Cache UI element references for performance
 */
function cacheUIElements() {
  // Core game elements
  slapBtn = document.getElementById('slap-btn');
  scoreEl = document.getElementById('score');
  comboEl = document.getElementById('combo');
  progressBar = document.getElementById('progress-fill');
  
  // Sections
  powerupsGrid = document.getElementById('powerups-grid');
  leaderboardList = document.getElementById('leaderboard-list');
  dailyRewardSection = document.getElementById('daily-reward');
  
  // Overlays and modals
  onboardingOverlay = document.getElementById('onboarding-overlay');
  helpOverlay = document.getElementById('help-overlay');
  
  // Toast notifications
  errorToast = document.getElementById('error-toast');
  successToast = document.getElementById('success-toast');
  
  // User info elements
  rankDisplay = document.getElementById('user-rank');
  
  console.log('UI elements cached successfully');
}

/**
 * Set up all event listeners
 */
function setupEventListeners() {
  // Main slap button
  if (slapBtn) {
    slapBtn.addEventListener('click', handleSlapClick);
    slapBtn.addEventListener('touchstart', handleSlapTouchStart, { passive: true });
    
    // Add keyboard support
    slapBtn.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        handleSlapClick();
      }
    });
  }

  // Power-up buttons
  if (powerupsGrid) {
    powerupsGrid.addEventListener('click', handlePowerUpClick);
  }

  // Daily reward
  const claimDailyBtn = document.getElementById('claim-daily');
  if (claimDailyBtn) {
    claimDailyBtn.addEventListener('click', handleDailyRewardClaim);
  }

  // UI controls
  const helpBtn = document.getElementById('help-btn');
  if (helpBtn) {
    helpBtn.addEventListener('click', () => showHelp());
  }

  const closeHelpBtn = document.getElementById('close-help');
  if (closeHelpBtn) {
    closeHelpBtn.addEventListener('click', () => hideHelp());
  }

  const soundBtn = document.getElementById('sound-btn');
  if (soundBtn) {
    soundBtn.addEventListener('click', handleSoundToggle);
  }

  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', handleShare);
  }

  const startGameBtn = document.getElementById('start-game');
  if (startGameBtn) {
    startGameBtn.addEventListener('click', () => hideOnboarding());
  }

  const refreshLeaderboardBtn = document.getElementById('refresh-leaderboard');
  if (refreshLeaderboardBtn) {
    refreshLeaderboardBtn.addEventListener('click', handleRefreshLeaderboard);
  }

  // Close overlays when clicking outside
  [onboardingOverlay, helpOverlay].forEach(overlay => {
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.add('hidden');
        }
      });
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    switch (e.key) {
      case ' ':
        if (e.target === document.body) {
          e.preventDefault();
          handleSlapClick();
        }
        break;
      case 'h':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          showHelp();
        }
        break;
      case 'Escape':
        hideHelp();
        hideOnboarding();
        break;
    }
  });
}

/**
 * Handle slap button click
 */
function handleSlapClick() {
  if (eventHandlers.onSlap) {
    eventHandlers.onSlap();
  }
  
  // Visual feedback
  if (slapBtn) {
    slapBtn.classList.add('slap-active');
    setTimeout(() => {
      slapBtn.classList.remove('slap-active');
    }, 150);
  }
  
  // Create floating point animation
  createFloatingPoints('+1');
  
  // Haptic feedback
  if (isInsideTelegram()) {
    hapticFeedback('impact', 'light');
  } else if (navigator.vibrate) {
    navigator.vibrate(50);
  }
}

/**
 * Handle touch start for slap button (for better mobile responsiveness)
 */
function handleSlapTouchStart() {
  if (slapBtn) {
    slapBtn.classList.add('slap-pressed');
    setTimeout(() => {
      slapBtn.classList.remove('slap-pressed');
    }, 100);
  }
}

/**
 * Handle power-up activation
 */
function handlePowerUpClick(e) {
  const powerUpCard = e.target.closest('.powerup-card');
  if (!powerUpCard || powerUpCard.classList.contains('locked') || powerUpCard.classList.contains('cooldown')) {
    return;
  }
  
  const powerUpId = powerUpCard.dataset.powerup;
  if (eventHandlers.onPowerUpActivate && powerUpId) {
    eventHandlers.onPowerUpActivate(powerUpId);
  }
}

/**
 * Handle daily reward claim
 */
function handleDailyRewardClaim() {
  if (eventHandlers.onDailyRewardClaim) {
    eventHandlers.onDailyRewardClaim();
  }
}

/**
 * Handle sound toggle
 */
function handleSoundToggle() {
  if (eventHandlers.onSoundToggle) {
    eventHandlers.onSoundToggle();
  }
}

/**
 * Handle share button
 */
function handleShare() {
  const state = getState();
  if (eventHandlers.onShare) {
    eventHandlers.onShare(state.score);
  }
}

/**
 * Handle leaderboard refresh
 */
function handleRefreshLeaderboard() {
  if (eventHandlers.onRefreshLeaderboard) {
    eventHandlers.onRefreshLeaderboard();
  }
}

/**
 * Update UI with current game state
 */
export function updateUI() {
  const state = getState();
  if (!state) return;

  // Update score with animation
  updateScore(state.score);
  
  // Update combo with animation
  updateCombo(state.combo);
  
  // Update progress bar
  updateProgress(state.score);
  
  // Update power-ups
  updatePowerUps(state.powerUps);
  
  // Update daily reward
  updateDailyReward(state);
  
  // Update user info
  updateUserInfo();
  
  // Update leaderboard
  updateLeaderboard();
}

/**
 * Update score display with animation
 */
function updateScore(newScore) {
  if (!scoreEl || newScore === lastScore) return;
  
  // Animate score counting up
  const startScore = lastScore;
  const increment = (newScore - startScore) / 30;
  let currentScore = startScore;
  let frames = 0;
  
  const animateScore = () => {
    if (frames < 30 && currentScore < newScore) {
      currentScore += increment;
      scoreEl.textContent = Math.floor(currentScore).toLocaleString();
      frames++;
      requestAnimationFrame(animateScore);
    } else {
      scoreEl.textContent = newScore.toLocaleString();
    }
  };
  
  animateScore();
  lastScore = newScore;
  
  // Add score increase effect
  scoreEl.classList.add('score-increase');
  setTimeout(() => {
    scoreEl.classList.remove('score-increase');
  }, 600);
}

/**
 * Update combo display
 */
function updateCombo(newCombo) {
  if (!comboEl || newCombo === lastCombo) return;
  
  comboEl.textContent = `${newCombo}x`;
  
  // Special effects for high combos
  if (newCombo > lastCombo && newCombo > 1) {
    comboEl.classList.add('combo-increase');
    
    // Create floating combo text
    createFloatingPoints(`${newCombo}x COMBO!`);
    
    setTimeout(() => {
      comboEl.classList.remove('combo-increase');
    }, 1000);
  }
  
  lastCombo = newCombo;
}

/**
 * Update progress bar
 */
function updateProgress(score) {
  if (!progressBar) return;
  
  const milestones = [100, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000];
  let currentLevel = 1;
  let nextMilestone = milestones[0];
  let prevMilestone = 0;
  
  // Find current level
  for (let i = 0; i < milestones.length; i++) {
    if (score >= milestones[i]) {
      currentLevel = i + 2;
      prevMilestone = milestones[i];
      nextMilestone = milestones[i + 1] || milestones[i] * 2;
    } else {
      nextMilestone = milestones[i];
      break;
    }
  }
  
  // Calculate progress percentage
  const progress = ((score - prevMilestone) / (nextMilestone - prevMilestone)) * 100;
  progressBar.style.width = `${Math.min(progress, 100)}%`;
  
  // Update level text
  const currentLevelEl = document.getElementById('current-level');
  const nextMilestoneEl = document.getElementById('next-milestone');
  
  if (currentLevelEl) {
    currentLevelEl.textContent = `Level ${currentLevel}`;
  }
  
  if (nextMilestoneEl) {
    nextMilestoneEl.textContent = `Next: ${nextMilestone.toLocaleString()} pts`;
  }
}

/**
 * Update power-ups display
 */
function updatePowerUps(powerUps) {
  if (!powerupsGrid || !powerUps) return;
  
  Object.entries(powerUps).forEach(([id, powerUp]) => {
    const card = powerupsGrid.querySelector(`[data-powerup="${id}"]`);
    if (!card) return;
    
    // Update unlock status
    if (powerUp.unlocked) {
      card.classList.remove('locked');
      card.classList.add('unlocked');
    }
    
    // Update active status
    if (powerUp.active) {
      card.classList.add('active');
      const statusEl = card.querySelector('.powerup-status');
      if (statusEl) {
        statusEl.textContent = `Active (${Math.ceil(powerUp.duration / 1000)}s)`;
      }
    } else if (powerUp.cooldown > 0) {
      card.classList.add('cooldown');
      card.classList.remove('active');
      const statusEl = card.querySelector('.powerup-status');
      if (statusEl) {
        statusEl.textContent = `Cooldown (${Math.ceil(powerUp.cooldown / 1000)}s)`;
      }
    } else if (powerUp.unlocked) {
      card.classList.remove('active', 'cooldown');
      const statusEl = card.querySelector('.powerup-status');
      if (statusEl) {
        statusEl.textContent = 'Ready to use!';
      }
    }
  });
}

/**
 * Update daily reward section
 */
function updateDailyReward(state) {
  if (!dailyRewardSection || !state) return;
  
  const claimBtn = dailyRewardSection.querySelector('#claim-daily');
  if (!claimBtn) return;
  
  if (state.dailyClaimed) {
    claimBtn.disabled = true;
    claimBtn.textContent = 'Claimed Today!';
    claimBtn.classList.add('claimed');
  } else {
    claimBtn.disabled = false;
    claimBtn.textContent = 'Claim 100 pts';
    claimBtn.classList.remove('claimed');
  }
}

/**
 * Update user info display
 */
function updateUserInfo() {
  const user = getUser();
  const userNameEl = document.getElementById('user-name');
  
  if (userNameEl && user) {
    userNameEl.textContent = user.first_name || user.username || 'Player';
  }
  
  // Update rank display
  if (rankDisplay) {
    const leaderboard = getLeaderboard();
    const userId = user?.id;
    const rank = leaderboard.findIndex(entry => entry.id === userId) + 1;
    
    if (rank > 0) {
      rankDisplay.textContent = `#${rank}`;
      rankDisplay.classList.remove('hidden');
    } else {
      rankDisplay.classList.add('hidden');
    }
  }
}

/**
 * Update leaderboard display
 */
function updateLeaderboard() {
  if (!leaderboardList) return;
  
  const leaderboard = getLeaderboard();
  const user = getUser();
  
  if (leaderboard.length === 0) {
    leaderboardList.innerHTML = '<div class="no-data">No players yet. Be the first!</div>';
    return;
  }
  
  leaderboardList.innerHTML = leaderboard
    .slice(0, 10) // Show top 10
    .map((entry, index) => {
      const isCurrentUser = user && entry.id === user.id;
      return `
        <div class="leaderboard-item ${isCurrentUser ? 'current-user' : ''}">
          <div class="rank-badge rank-${index + 1}">#${index + 1}</div>
          <div class="player-info">
            <div class="player-name">${entry.name}</div>
            <div class="player-score">${entry.score.toLocaleString()} pts</div>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * Create floating point animation
 */
function createFloatingPoints(text) {
  const container = document.getElementById('floating-points');
  if (!container) return;
  
  const element = document.createElement('div');
  element.className = 'floating-point';
  element.textContent = text;
  
  // Position near slap button
  if (slapBtn) {
    const rect = slapBtn.getBoundingClientRect();
    element.style.left = `${rect.left + rect.width / 2}px`;
    element.style.top = `${rect.top}px`;
  }
  
  container.appendChild(element);
  
  // Remove after animation
  setTimeout(() => {
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }, 2000);
}

/**
 * Show/hide loading screen
 */
export function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loading-screen');
  const appContainer = document.querySelector('.app-container');
  
  if (loadingScreen) {
    loadingScreen.classList.add('fade-out');
    setTimeout(() => {
      loadingScreen.style.display = 'none';
    }, 500);
  }
  
  if (appContainer) {
    appContainer.style.display = 'block';
  }
}

/**
 * Show/hide onboarding
 */
export function showOnboarding() {
  if (onboardingOverlay) {
    onboardingOverlay.classList.remove('hidden');
  }
}

export function hideOnboarding() {
  if (onboardingOverlay) {
    onboardingOverlay.classList.add('hidden');
  }
  
  // Focus slap button for immediate gameplay
  focusSlapButton();
}

/**
 * Show/hide help
 */
export function showHelp() {
  if (helpOverlay) {
    helpOverlay.classList.remove('hidden');
  }
}

export function hideHelp() {
  if (helpOverlay) {
    helpOverlay.classList.add('hidden');
  }
}

/**
 * Focus the slap button
 */
export function focusSlapButton() {
  if (slapBtn) {
    slapBtn.focus();
  }
}

/**
 * Show toast notification
 */
export function showToast(message, type = 'info', duration = 3000) {
  const toast = type === 'error' ? errorToast : successToast;
  if (!toast) return;
  
  const messageEl = toast.querySelector('.toast-message');
  if (messageEl) {
    messageEl.textContent = message;
  }
  
  toast.classList.remove('hidden');
  
  setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

/**
 * Announce message for screen readers
 */
export function announce(message) {
  // Create live region for screen reader announcements
  let liveRegion = document.getElementById('live-region');
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'live-region';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.className = 'sr-only';
    document.body.appendChild(liveRegion);
  }
  
  liveRegion.textContent = message;
}

/**
 * Setup accessibility features
 */
function setupAccessibility() {
  // Add skip link
  const skipLink = document.createElement('a');
  skipLink.href = '#slap-btn';
  skipLink.textContent = 'Skip to main game';
  skipLink.className = 'skip-link';
  document.body.insertBefore(skipLink, document.body.firstChild);
  
  // Add ARIA labels and roles
  if (slapBtn) {
    slapBtn.setAttribute('aria-describedby', 'slap-description');
    
    const description = document.createElement('div');
    description.id = 'slap-description';
    description.className = 'sr-only';
    description.textContent = 'Main game button. Tap repeatedly to earn points and build combos.';
    slapBtn.parentNode.insertBefore(description, slapBtn.nextSibling);
  }
  
  // Set up reduced motion preferences
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.body.classList.add('reduced-motion');
  }
  
  // High contrast support
  if (window.matchMedia('(prefers-contrast: high)').matches) {
    document.body.classList.add('high-contrast');
  }
}

/**
 * Update theme
 */
export function updateTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Cleanup function
 */
export function cleanup() {
  // Clear all animation timeouts
  animationTimeouts.forEach(timeout => clearTimeout(timeout));
  animationTimeouts.clear();
  
  // Remove event listeners
  if (slapBtn) {
    slapBtn.replaceWith(slapBtn.cloneNode(true));
  }
}

// Export for debugging
if (window.location.hostname === 'localhost') {
  window.uiDebug = {
    updateUI,
    showToast,
    createFloatingPoints,
    announce
  };
}

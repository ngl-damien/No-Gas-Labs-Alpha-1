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
let gameHeader, dailyRewardSection;

// UI State
let lastScore = 0;
let lastCombo = 0;
let animationTimeouts = new Set();

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
    <!-- Game Header -->
    <header class="game-header" role="banner">
      <h1 class="game-title" id="game-title">No_Gas_Slaps™</h1>
      <div class="header-actions">
        <button class="btn-icon" id="mute-btn" aria-label="${t('ui.toggleMute')}" title="${t('ui.toggleMute')}">
          🔊
        </button>
        <button class="btn-icon" id="help-btn" aria-label="${t('ui.showHelp')}" title="${t('ui.showHelp')}">
          ❓
        </button>
      </div>
    </header>

    <!-- Score Display -->
    <section class="score-container" role="region" aria-labelledby="score-label">
      <div class="score-label" id="score-label">${t('ui.currentScore')}</div>
      <div class="score-value" id="score-value" aria-live="polite">0</div>
    </section>

    <!-- Combo Display -->
    <section class="combo-container" id="combo-container" role="region" aria-labelledby="combo-label" aria-live="polite">
      <div class="combo-label" id="combo-label" class="sr-only">${t('ui.comboMultiplier')}</div>
      <div class="combo-multiplier" id="combo-value"></div>
      <div class="combo-timer">
        <div class="combo-progress" id="combo-progress"></div>
      </div>
    </section>

    <!-- Main Slap Button -->
    <section class="slap-section" role="region" aria-labelledby="slap-label">
      <div class="slap-label sr-only" id="slap-label">${t('ui.mainAction')}</div>
      <button class="slap-button" id="slap-btn" 
              aria-label="${t('ui.slapButton')}" 
              aria-describedby="slap-description"
              aria-keyshortcuts="Space Enter">
        <span class="slap-text">👋 ${t('ui.slapText')}</span>
      </button>
      <div class="slap-description sr-only" id="slap-description">
        ${t('ui.slapDescription')}
      </div>
    </section>

    <!-- Daily Reward Section -->
    <section class="daily-reward hidden" id="daily-reward" role="region" aria-labelledby="daily-title">
      <h3 class="daily-reward-title" id="daily-title">${t('ui.dailyReward')}</h3>
      <div class="daily-reward-amount" id="daily-amount">+100 ${t('ui.points')}</div>
      <button class="daily-reward-button" id="daily-btn" aria-describedby="daily-description">
        ${t('ui.claimReward')}
      </button>
      <div class="daily-description sr-only" id="daily-description">
        ${t('ui.dailyRewardDescription')}
      </div>
    </section>

    <!-- Power-ups Section -->
    <section class="powerups-container" role="region" aria-labelledby="powerups-title">
      <h2 class="powerups-title" id="powerups-title">${t('ui.powerUps')}</h2>
      <div class="powerups-grid" id="powerups-grid" role="group" aria-labelledby="powerups-title">
        <!-- Power-ups will be dynamically generated -->
      </div>
    </section>

    <!-- Leaderboard Section -->
    <section class="leaderboard-container" role="region" aria-labelledby="leaderboard-title">
      <div class="leaderboard-header">
        <h2 class="leaderboard-title" id="leaderboard-title">${t('ui.leaderboard')}</h2>
        <button class="leaderboard-refresh" id="refresh-btn" 
                aria-label="${t('ui.refreshLeaderboard')}"
                title="${t('ui.refreshLeaderboard')}">
          🔄
        </button>
      </div>
      <ol class="leaderboard-list" id="leaderboard-list" 
          role="list" 
          aria-labelledby="leaderboard-title"
          tabindex="0">
        <!-- Leaderboard items will be dynamically generated -->
      </ol>
    </section>

    <!-- Share Section -->
    <section class="share-section" role="region">
      <button class="btn btn-secondary" id="share-btn" aria-label="${t('ui.shareScore')}">
        📤 ${t('ui.shareScore')}
      </button>
    </section>
  `;
}

/**
 * Cache UI element references for performance
 */
function cacheUIElements() {
  // Main elements
  slapBtn = document.getElementById('slap-btn');
  scoreEl = document.getElementById('score-value');
  comboEl = document.getElementById('combo-value');
  leaderboardList = document.getElementById('leaderboard-list');
  powerupsGrid = document.getElementById('powerups-grid');
  
  // Overlay elements
  onboardingOverlay = document.getElementById('onboarding-overlay');
  helpOverlay = document.getElementById('help-overlay');
  errorToast = document.getElementById('error-toast');
  successToast = document.getElementById('success-toast');
  
  // Other sections
  gameHeader = document.querySelector('.game-header');
  dailyRewardSection = document.getElementById('daily-reward');
  
  // Validate critical elements
  if (!slapBtn || !scoreEl) {
    throw new Error('Critical UI elements not found');
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Slap button events
  slapBtn.addEventListener('click', handleSlapClick);
  slapBtn.addEventListener('keydown', handleSlapKeydown);
  
  // Touch events for mobile
  slapBtn.addEventListener('touchstart', handleTouchStart, { passive: true });
  slapBtn.addEventListener('touchend', handleTouchEnd, { passive: true });
  
  // Header button events
  const muteBtn = document.getElementById('mute-btn');
  const helpBtn = document.getElementById('help-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const shareBtn = document.getElementById('share-btn');
  const dailyBtn = document.getElementById('daily-btn');
  
  muteBtn?.addEventListener('click', () => eventHandlers.onToggleMute?.());
  helpBtn?.addEventListener('click', () => eventHandlers.onShowHelp?.());
  refreshBtn?.addEventListener('click', () => eventHandlers.onRefreshLeaderboard?.());
  shareBtn?.addEventListener('click', () => eventHandlers.onShare?.());
  dailyBtn?.addEventListener('click', () => eventHandlers.onClaimDaily?.());
  
  // Onboarding events
  const onboardingStart = document.getElementById('onboarding-start');
  const onboardingSkip = document.getElementById('onboarding-skip');
  
  onboardingStart?.addEventListener('click', handleOnboardingComplete);
  onboardingSkip?.addEventListener('click', handleOnboardingComplete);
  
  // Help overlay events
  const helpClose = document.getElementById('help-close');
  helpClose?.addEventListener('click', hideHelp);
  
  // Toast events
  const errorClose = errorToast?.querySelector('.toast-close');
  const successClose = successToast?.querySelector('.toast-close');
  
  errorClose?.addEventListener('click', hideErrorToast);
  successClose?.addEventListener('click', hideSuccessToast);
  
  // Global keyboard shortcuts
  document.addEventListener('keydown', handleGlobalKeydown);
  
  // Escape key handling
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!helpOverlay?.classList.contains('hidden')) {
        hideHelp();
      } else if (!onboardingOverlay?.classList.contains('hidden')) {
        hideOnboarding();
      }
    }
  });
  
  // Focus management
  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('focusout', handleFocusOut);
}

/**
 * Set up accessibility features
 */
function setupAccessibility() {
  // Set up ARIA live regions
  const scoreEl = document.getElementById('score-value');
  const comboContainer = document.getElementById('combo-container');
  
  if (scoreEl) {
    scoreEl.setAttribute('aria-live', 'polite');
    scoreEl.setAttribute('aria-atomic', 'true');
  }
  
  if (comboContainer) {
    comboContainer.setAttribute('aria-live', 'polite');
    comboContainer.setAttribute('aria-atomic', 'false');
  }
  
  // Set up keyboard navigation
  setupKeyboardNavigation();
  
  // Set up screen reader announcements
  setupScreenReaderSupport();
  
  // Check for reduced motion preference
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (prefersReducedMotion.matches) {
    document.body.classList.add('reduced-motion');
  }
}

/**
 * Set up keyboard navigation
 */
function setupKeyboardNavigation() {
  const focusableElements = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusableContent = document.querySelectorAll(focusableElements);
  
  // Add skip link functionality
  const skipLink = document.createElement('a');
  skipLink.href = '#slap-btn';
  skipLink.className = 'skip-link sr-only';
  skipLink.textContent = t('accessibility.skipToMain');
  skipLink.addEventListener('focus', () => skipLink.classList.remove('sr-only'));
  skipLink.addEventListener('blur', () => skipLink.classList.add('sr-only'));
  
  document.body.insertBefore(skipLink, document.body.firstChild);
}

/**
 * Set up screen reader support
 */
function setupScreenReaderSupport() {
  // Add role and aria-label to main elements
  const main = document.querySelector('main');
  if (main) {
    main.setAttribute('role', 'main');
    main.setAttribute('aria-label', t('accessibility.mainGameArea'));
  }
  
  // Set up live regions for dynamic content
  const announcer = document.getElementById('sr-announcer');
  if (announcer) {
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
  }
}

/**
 * Handle slap button click
 */
async function handleSlapClick(e) {
  e.preventDefault();
  
  // Visual feedback
  slapBtn.classList.add('slap-animation');
  setTimeout(() => slapBtn.classList.remove('slap-animation'), 600);
  
  // Haptic feedback
  if (isInsideTelegram()) {
    hapticFeedback('impact', 'light');
  }
  
  // Call slap handler
  await eventHandlers.onSlap?.();
}

/**
 * Handle slap button keyboard events
 */
function handleSlapKeydown(e) {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    handleSlapClick(e);
  }
}

/**
 * Handle touch start for mobile feedback
 */
function handleTouchStart(e) {
  slapBtn.style.transform = 'scale(0.95)';
}

/**
 * Handle touch end for mobile feedback
 */
function handleTouchEnd(e) {
  slapBtn.style.transform = '';
}

/**
 * Handle global keyboard shortcuts
 */
function handleGlobalKeydown(e) {
  // Space or Enter for slap (when focused on slap button or no other element)
  if ((e.key === ' ' || e.key === 'Enter') && 
      (e.target === slapBtn || e.target === document.body)) {
    e.preventDefault();
    handleSlapClick(e);
  }
  
  // H for help
  if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.metaKey) {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      eventHandlers.onShowHelp?.();
    }
  }
  
  // M for mute
  if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      eventHandlers.onToggleMute?.();
    }
  }
  
  // R for refresh leaderboard
  if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      eventHandlers.onRefreshLeaderboard?.();
    }
  }
}

/**
 * Handle focus events for accessibility
 */
function handleFocusIn(e) {
  // Add focus indicator for keyboard users
  if (e.target.matches('button, a, input, select, textarea')) {
    e.target.classList.add('keyboard-focus');
  }
}

/**
 * Handle focus out events
 */
function handleFocusOut(e) {
  e.target.classList.remove('keyboard-focus');
}

/**
 * Update UI with current game state
 */
export function updateUI() {
  const state = getState();
  const leaderboard = getLeaderboard();
  const user = getUser();
  const error = getError();
  const success = getCurrentSuccess();
  
  // Update score with animation
  updateScore(state.score);
  
  // Update combo display
  updateCombo(state.combo);
  
  // Update power-ups
  updatePowerUps(state.powerUps);
  
  // Update leaderboard
  updateLeaderboard(leaderboard, user);
  
  // Update daily reward
  updateDailyReward(state.dailyClaimed);
  
  // Update error/success states
  if (error) {
    showErrorToast(error);
  }
  
  if (success) {
    showSuccessToast(success);
  }
}

/**
 * Update score display with animation
 */
function updateScore(newScore) {
  if (newScore === lastScore) return;
  
  // Animate score change
  if (newScore > lastScore) {
    scoreEl.classList.add('score-bump');
    setTimeout(() => scoreEl.classList.remove('score-bump'), 300);
  }
  
  // Update score text with formatting
  scoreEl.textContent = formatNumber(newScore);
  scoreEl.setAttribute('aria-label', t('ui.scoreAnnouncement', { score: newScore }));
  
  lastScore = newScore;
}

/**
 * Update combo display
 */
function updateCombo(newCombo) {
  const comboContainer = document.getElementById('combo-container');
  
  if (newCombo <= 1) {
    comboContainer.classList.remove('active');
    comboEl.textContent = '';
    return;
  }
  
  // Show combo
  comboContainer.classList.add('active');
  comboEl.textContent = t('ui.comboDisplay', { multiplier: newCombo });
  comboEl.setAttribute('aria-label', t('ui.comboAnnouncement', { multiplier: newCombo }));
  
  // Animate combo change
  if (newCombo > lastCombo) {
    comboEl.style.transform = 'scale(1.2)';
    setTimeout(() => comboEl.style.transform = '', 200);
  }
  
  lastCombo = newCombo;
}

/**
 * Update power-ups display
 */
function updatePowerUps(powerUps) {
  if (!powerupsGrid) return;
  
  // Clear existing power-ups
  powerupsGrid.innerHTML = '';
  
  // Add each power-up
  Object.entries(powerUps).forEach(([id, powerUp]) => {
    const powerUpEl = createPowerUpElement(id, powerUp);
    powerupsGrid.appendChild(powerUpEl);
  });
}

/**
 * Create power-up element
 */
function createPowerUpElement(id, powerUp) {
  const isAvailable = powerUp.unlocked && !powerUp.cooldown;
  const cooldownTime = powerUp.cooldown > 0 ? Math.ceil(powerUp.cooldown / 1000) : 0;
  
  const powerUpEl = document.createElement('div');
  powerUpEl.className = `powerup-card ${isAvailable ? 'available' : ''} ${cooldownTime > 0 ? 'cooldown' : ''}`;
  powerUpEl.setAttribute('role', 'button');
  powerUpEl.setAttribute('tabindex', isAvailable ? '0' : '-1');
  powerUpEl.setAttribute('aria-label', t(`powerups.${id}.name`));
  powerUpEl.setAttribute('aria-describedby', `powerup-desc-${id}`);
  
  powerUpEl.innerHTML = `
    <div class="powerup-icon">${getPowerUpIcon(id)}</div>
    <div class="powerup-name">${t(`powerups.${id}.name`)}</div>
    <div class="powerup-description" id="powerup-desc-${id}">
      ${t(`powerups.${id}.description`)}
    </div>
    ${cooldownTime > 0 ? `<div class="powerup-cooldown">${cooldownTime}s</div>` : ''}
  `;
  
  // Add event listeners
  if (isAvailable) {
    powerUpEl.addEventListener('click', () => eventHandlers.onActivatePowerUp?.(id));
    powerUpEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        eventHandlers.onActivatePowerUp?.(id);
      }
    });
  }
  
  return powerUpEl;
}

/**
 * Get power-up icon
 */
function getPowerUpIcon(id) {
  const icons = {
    doublePoints: '⚡',
    rapidFire: '🔥',
    shield: '🛡️',
    magnet: '🧲',
    boost: '🚀'
  };
  
  return icons[id] || '⭐';
}

/**
 * Update leaderboard display
 */
function updateLeaderboard(leaderboard, currentUser) {
  if (!leaderboardList || !Array.isArray(leaderboard)) return;
  
  // Clear existing items
  leaderboardList.innerHTML = '';
  
  // Add each leaderboard entry
  leaderboard.forEach((entry, index) => {
    const isCurrentUser = currentUser && entry.id === currentUser.id;
    const listItem = createLeaderboardItem(entry, index + 1, isCurrentUser);
    leaderboardList.appendChild(listItem);
  });
  
  // Add empty state if no entries
  if (leaderboard.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'leaderboard-empty';
    emptyItem.textContent = t('ui.leaderboardEmpty');
    emptyItem.setAttribute('role', 'status');
    leaderboardList.appendChild(emptyItem);
  }
}

/**
 * Create leaderboard item element
 */
function createLeaderboardItem(entry, rank, isCurrentUser) {
  const listItem = document.createElement('li');
  listItem.className = `leaderboard-item ${isCurrentUser ? 'current-user' : ''}`;
  listItem.setAttribute('role', 'listitem');
  listItem.style.setProperty('--item-index', rank - 1);
  
  const rankEl = document.createElement('span');
  rankEl.className = 'leaderboard-rank';
  rankEl.textContent = `#${rank}`;
  rankEl.setAttribute('aria-label', t('ui.rankPosition', { rank }));
  
  const playerEl = document.createElement('span');
  playerEl.className = 'leaderboard-player';
  playerEl.textContent = entry.name || t('ui.anonymousPlayer');
  
  const scoreEl = document.createElement('span');
  scoreEl.className = 'leaderboard-score';
  scoreEl.textContent = formatNumber(entry.score);
  scoreEl.setAttribute('aria-label', t('ui.playerScore', { score: entry.score }));
  
  listItem.appendChild(rankEl);
  listItem.appendChild(playerEl);
  listItem.appendChild(scoreEl);
  
  // Add accessibility attributes
  listItem.setAttribute('aria-label', 
    t('ui.leaderboardEntry', { 
      rank, 
      name: entry.name || t('ui.anonymousPlayer'), 
      score: entry.score 
    })
  );
  
  return listItem;
}

/**
 * Update daily reward section
 */
function updateDailyReward(dailyClaimed) {
  if (!dailyRewardSection) return;
  
  if (dailyClaimed) {
    dailyRewardSection.classList.add('hidden');
  } else {
    dailyRewardSection.classList.remove('hidden');
  }
}

/**
 * Show onboarding overlay
 */
export function showOnboarding(onComplete) {
  if (!onboardingOverlay) return;
  
  onboardingOverlay.classList.remove('hidden');
  
  // Focus management
  const firstButton = onboardingOverlay.querySelector('button');
  setTimeout(() => firstButton?.focus(), 100);
  
  // Store completion callback
  onboardingOverlay.dataset.onComplete = 'true';
  window.onboardingComplete = onComplete;
}

/**
 * Hide onboarding overlay
 */
export function hideOnboarding() {
  if (!onboardingOverlay) return;
  
  onboardingOverlay.classList.add('hidden');
  
  // Return focus to slap button
  setTimeout(focusSlapButton, 100);
}

/**
 * Handle onboarding completion
 */
function handleOnboardingComplete() {
  if (window.onboardingComplete) {
    window.onboardingComplete();
    delete window.onboardingComplete;
  }
}

/**
 * Show help overlay
 */
export function showHelp() {
  if (!helpOverlay) return;
  
  helpOverlay.classList.remove('hidden');
  
  // Focus management
  const closeButton = helpOverlay.querySelector('#help-close');
  setTimeout(() => closeButton?.focus(), 100);
}

/**
 * Hide help overlay
 */
export function hideHelp() {
  if (!helpOverlay) return;
  
  helpOverlay.classList.add('hidden');
  
  // Return focus to help button
  const helpBtn = document.getElementById('help-btn');
  setTimeout(() => helpBtn?.focus(), 100);
}

/**
 * Show error toast
 */
function showErrorToast(message) {
  if (!errorToast) return;
  
  const messageEl = document.getElementById('error-message');
  if (messageEl) {
    messageEl.textContent = message;
  }
  
  errorToast.classList.remove('hidden');
  errorToast.classList.add('show');
  
  // Auto-hide after 5 seconds
  setTimeout(hideErrorToast, 5000);
}

/**
 * Hide error toast
 */
function hideErrorToast() {
  if (!errorToast) return;
  
  errorToast.classList.remove('show');
  setTimeout(() => errorToast.classList.add('hidden'), 300);
}

/**
 * Show success toast
 */
function showSuccessToast(message) {
  if (!successToast) return;
  
  const messageEl = document.getElementById('success-message');
  if (messageEl) {
    messageEl.textContent = message;
  }
  
  successToast.classList.remove('hidden');
  successToast.classList.add('show');
  
  // Auto-hide after 3 seconds
  setTimeout(hideSuccessToast, 3000);
}

/**
 * Hide success toast
 */
function hideSuccessToast() {
  if (!successToast) return;
  
  successToast.classList.remove('show');
  setTimeout(() => successToast.classList.add('hidden'), 300);
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
 * Announce message for screen readers
 */
export function announce(message) {
  const announcer = document.getElementById('sr-announcer');
  if (announcer) {
    announcer.textContent = message;
    
    // Clear after announcement
    setTimeout(() => {
      announcer.textContent = '';
    }, 1000);
  }
}

/**
 * Format number for display
 */
function formatNumber(num) {
  if (num < 1000) return num.toString();
  if (num < 1000000) return (num / 1000).toFixed(1) + 'K';
  if (num < 1000000000) return (num / 1000000).toFixed(1) + 'M';
  return (num / 1000000000).toFixed(1) + 'B';
}

/**
 * Clean up timeouts and listeners
 */
export function cleanup() {
  // Clear all animation timeouts
  animationTimeouts.forEach(timeout => clearTimeout(timeout));
  animationTimeouts.clear();
  
  // Remove global event listeners
  document.removeEventListener('keydown', handleGlobalKeydown);
  document.removeEventListener('focusin', handleFocusIn);
  document.removeEventListener('focusout', handleFocusOut);
}

/**
 * Game State Management Module
 * Handles all game logic, state transitions, and persistence
 */

import { loadState, saveState } from './persistence.js';
import { showError } from './error.js';
import { sanitizeInput } from './security.js';

// State configuration
const STATE_KEY = 'ngs_game_state_v2';
const POWERUPS_KEY = 'ngs_powerups_v1';

// Anti-cheat configuration
const MAX_TAPS_PER_SECOND = 4;
const MIN_INTERVAL = 1000 / MAX_TAPS_PER_SECOND;
const COMBO_TIMEOUT = 1200; // milliseconds
const MAX_SCORE_INCREMENT = 1000; // Max points per single slap
const SUSPICIOUS_JUMP_THRESHOLD = 5000; // Score increase threshold for cheat detection

// Game state
let gameState = {
  score: 0,
  combo: 1,
  lastSlapAt: 0,
  lastComboTick: 0,
  totalSlaps: 0,
  sessionStartTime: Date.now(),
  dailyClaimed: false,
  lastDailyClaim: 0,
  achievements: [],
  statistics: {
    totalPlayTime: 0,
    highestCombo: 0,
    totalTaps: 0,
    sessionsPlayed: 0
  }
};

// Power-ups state
let powerUpsState = {
  doublePoints: {
    unlocked: false,
    active: false,
    cooldown: 0,
    duration: 0,
    unlockThreshold: 500
  },
  rapidFire: {
    unlocked: false,
    active: false,
    cooldown: 0,
    duration: 0,
    unlockThreshold: 1000
  },
  shield: {
    unlocked: false,
    active: false,
    cooldown: 0,
    duration: 0,
    unlockThreshold: 2000
  },
  magnet: {
    unlocked: false,
    active: false,
    cooldown: 0,
    duration: 0,
    unlockThreshold: 5000
  },
  boost: {
    unlocked: false,
    active: false,
    cooldown: 0,
    duration: 0,
    unlockThreshold: 10000
  }
};

// Anti-cheat tracking
let tapsWindow = [];
let lastScoreCheck = 0;
let scoreHistory = [];

// Event listeners
const stateListeners = [];
const powerUpListeners = [];

/**
 * Initialize game state from persistence
 */
export async function initState() {
  try {
    // Load saved game state
    const savedState = await loadState(STATE_KEY);
    if (savedState && typeof savedState === 'object') {
      gameState = { ...gameState, ...savedState };
      
      // Validate loaded state
      validateGameState();
    }
    
    // Update session info
    gameState.sessionStartTime = Date.now();
    gameState.statistics.sessionsPlayed = (gameState.statistics.sessionsPlayed || 0) + 1;
    
    // Start background tasks
    startBackgroundTasks();
    
    console.log('✅ Game state initialized:', gameState);
    notifyStateListeners();
    
  } catch (error) {
    console.error('Error initializing game state:', error);
    showError('Failed to load game progress. Starting fresh.');
    
    // Reset to default state on error
    resetGameState();
  }
}

/**
 * Initialize power-ups system
 */
export async function initPowerUps() {
  try {
    // Load saved power-ups state
    const savedPowerUps = await loadState(POWERUPS_KEY);
    if (savedPowerUps && typeof savedPowerUps === 'object') {
      powerUpsState = { ...powerUpsState, ...savedPowerUps };
    }
    
    // Check for newly unlocked power-ups
    checkPowerUpUnlocks();
    
    console.log('✅ Power-ups initialized:', powerUpsState);
    notifyPowerUpListeners();
    
  } catch (error) {
    console.error('Error initializing power-ups:', error);
    // Continue with default power-ups state
  }
}

/**
 * Handle slap action with anti-cheat protection
 */
export async function slap() {
  const now = Date.now();
  
  try {
    // Anti-cheat: Rate limiting
    if (!isValidTapRate(now)) {
      throw new Error('Tap rate too high. Please slow down!');
    }
    
    // Anti-cheat: Minimum interval
    if (now - gameState.lastSlapAt < MIN_INTERVAL) {
      return; // Silently ignore rapid taps
    }
    
    // Update tap tracking
    tapsWindow.push(now);
    gameState.totalSlaps++;
    gameState.statistics.totalTaps++;
    
    // Calculate combo
    const newCombo = calculateCombo(now);
    const prevScore = gameState.score;
    
    // Calculate base points
    let points = 1;
    
    // Apply combo multiplier
    points *= newCombo;
    
    // Apply active power-up effects
    points = applyPowerUpEffects(points);
    
    // Anti-cheat: Validate score increment
    if (points > MAX_SCORE_INCREMENT) {
      throw new Error('Invalid score increment detected');
    }
    
    // Update game state
    gameState.combo = newCombo;
    gameState.score += points;
    gameState.lastSlapAt = now;
    gameState.lastComboTick = now;
    
    // Update statistics
    gameState.statistics.highestCombo = Math.max(gameState.statistics.highestCombo, newCombo);
    
    // Anti-cheat: Track score history
    trackScoreHistory(gameState.score, now);
    
    // Check for achievements
    checkAchievements(prevScore, gameState.score);
    
    // Check for power-up unlocks
    checkPowerUpUnlocks();
    
    // Periodic save
    if (gameState.totalSlaps % 10 === 0) {
      await saveGameState();
    }
    
    notifyStateListeners();
    return points;
    
  } catch (error) {
    console.error('Slap error:', error);
    throw error;
  }
}

/**
 * Validate tap rate for anti-cheat
 */
function isValidTapRate(now) {
  // Clean old taps from window
  tapsWindow = tapsWindow.filter(time => now - time < 1000);
  
  // Check if within rate limit
  if (tapsWindow.length >= MAX_TAPS_PER_SECOND) {
    console.warn('Rate limit exceeded:', tapsWindow.length, 'taps in last second');
    return false;
  }
  
  return true;
}

/**
 * Calculate combo multiplier
 */
function calculateCombo(now) {
  if (now - gameState.lastComboTick < COMBO_TIMEOUT) {
    // Combo continues - increase multiplier
    return Math.min(gameState.combo + 1, 50); // Cap at 50x
  } else {
    // Combo broken - reset to 1
    return 1;
  }
}

/**
 * Apply power-up effects to points
 */
function applyPowerUpEffects(basePoints) {
  let points = basePoints;
  
  // Double Points power-up
  if (powerUpsState.doublePoints.active) {
    points *= 2;
  }
  
  // Rapid Fire power-up (allows higher tap rate)
  if (powerUpsState.rapidFire.active) {
    points *= 1.5;
  }
  
  // Boost power-up
  if (powerUpsState.boost.active) {
    points *= 3;
  }
  
  return Math.floor(points);
}

/**
 * Track score history for anti-cheat
 */
function trackScoreHistory(score, timestamp) {
  scoreHistory.push({ score, timestamp });
  
  // Keep only last 100 entries
  if (scoreHistory.length > 100) {
    scoreHistory.shift();
  }
  
  // Check for suspicious score jumps
  if (scoreHistory.length >= 2) {
    const prevEntry = scoreHistory[scoreHistory.length - 2];
    const scoreIncrease = score - prevEntry.score;
    const timeDiff = timestamp - prevEntry.timestamp;
    
    // Calculate points per second
    const pps = timeDiff > 0 ? (scoreIncrease / timeDiff) * 1000 : 0;
    
    // Flag suspicious activity
    if (scoreIncrease > SUSPICIOUS_JUMP_THRESHOLD || pps > 50) {
      console.warn('Suspicious score activity detected:', {
        scoreIncrease,
        timeDiff,
        pointsPerSecond: pps
      });
      
      // Could implement additional penalties here
    }
  }
}

/**
 * Check for achievements
 */
function checkAchievements(prevScore, newScore) {
  const milestones = [100, 500, 1000, 5000, 10000, 50000, 100000];
  
  milestones.forEach(milestone => {
    if (prevScore < milestone && newScore >= milestone) {
      unlockAchievement(`score_${milestone}`);
    }
  });
  
  // Combo achievements
  if (gameState.combo === 10 && !gameState.achievements.includes('combo_10')) {
    unlockAchievement('combo_10');
  }
  
  if (gameState.combo === 25 && !gameState.achievements.includes('combo_25')) {
    unlockAchievement('combo_25');
  }
}

/**
 * Unlock achievement
 */
function unlockAchievement(achievementId) {
  if (!gameState.achievements.includes(achievementId)) {
    gameState.achievements.push(achievementId);
    console.log('🏆 Achievement unlocked:', achievementId);
    
    // Could trigger celebration animation here
    const event = new CustomEvent('achievementUnlocked', { 
      detail: { achievement: achievementId } 
    });
    document.dispatchEvent(event);
  }
}

/**
 * Check for power-up unlocks
 */
function checkPowerUpUnlocks() {
  let unlocked = false;
  
  Object.entries(powerUpsState).forEach(([id, powerUp]) => {
    if (!powerUp.unlocked && gameState.score >= powerUp.unlockThreshold) {
      powerUp.unlocked = true;
      unlocked = true;
      console.log('🚀 Power-up unlocked:', id);
      
      // Trigger unlock animation
      const event = new CustomEvent('powerUpUnlocked', { 
        detail: { powerUpId: id } 
      });
      document.dispatchEvent(event);
    }
  });
  
  if (unlocked) {
    savePowerUpsState();
    notifyPowerUpListeners();
  }
}

/**
 * Activate power-up
 */
export async function activatePowerUp(powerUpId) {
  const powerUp = powerUpsState[powerUpId];
  
  if (!powerUp) {
    throw new Error('Invalid power-up ID');
  }
  
  if (!powerUp.unlocked) {
    throw new Error('Power-up not unlocked');
  }
  
  if (powerUp.cooldown > 0) {
    throw new Error('Power-up on cooldown');
  }
  
  if (powerUp.active) {
    throw new Error('Power-up already active');
  }
  
  // Activate power-up
  powerUp.active = true;
  powerUp.duration = getPowerUpDuration(powerUpId);
  powerUp.cooldown = getPowerUpCooldown(powerUpId);
  
  console.log(`⚡ Power-up activated: ${powerUpId}`);
  
  // Set up deactivation timer
  setTimeout(() => {
    deactivatePowerUp(powerUpId);
  }, powerUp.duration);
  
  await savePowerUpsState();
  notifyPowerUpListeners();
}

/**
 * Deactivate power-up
 */
function deactivatePowerUp(powerUpId) {
  const powerUp = powerUpsState[powerUpId];
  
  if (powerUp && powerUp.active) {
    powerUp.active = false;
    powerUp.duration = 0;
    
    console.log(`⏱️ Power-up deactivated: ${powerUpId}`);
    
    savePowerUpsState();
    notifyPowerUpListeners();
  }
}

/**
 * Get power-up duration in milliseconds
 */
function getPowerUpDuration(powerUpId) {
  const durations = {
    doublePoints: 30000,   // 30 seconds
    rapidFire: 15000,      // 15 seconds
    shield: 60000,         // 60 seconds
    magnet: 20000,         // 20 seconds
    boost: 10000           // 10 seconds
  };
  
  return durations[powerUpId] || 30000;
}

/**
 * Get power-up cooldown in milliseconds
 */
function getPowerUpCooldown(powerUpId) {
  const cooldowns = {
    doublePoints: 120000,  // 2 minutes
    rapidFire: 90000,      // 1.5 minutes
    shield: 180000,        // 3 minutes
    magnet: 150000,        // 2.5 minutes
    boost: 300000          // 5 minutes
  };
  
  return cooldowns[powerUpId] || 120000;
}

/**
 * Claim daily reward
 */
export async function claimDailyReward() {
  const now = Date.now();
  const lastClaim = gameState.lastDailyClaim || 0;
  const daysSinceLastClaim = Math.floor((now - lastClaim) / (24 * 60 * 60 * 1000));
  
  if (gameState.dailyClaimed && daysSinceLastClaim < 1) {
    throw new Error('Daily reward already claimed today');
  }
  
  // Calculate reward amount
  const baseReward = 100;
  const streakBonus = Math.min(daysSinceLastClaim, 7) * 20; // Max 7-day streak
  const totalReward = baseReward + streakBonus;
  
  // Apply reward
  gameState.score += totalReward;
  gameState.dailyClaimed = true;
  gameState.lastDailyClaim = now;
  
  console.log(`🎁 Daily reward claimed: ${totalReward} points`);
  
  await saveGameState();
  notifyStateListeners();
  
  return totalReward;
}

/**
 * Start background tasks
 */
function startBackgroundTasks() {
  // Update power-up cooldowns
  setInterval(() => {
    let updated = false;
    
    Object.values(powerUpsState).forEach(powerUp => {
      if (powerUp.cooldown > 0) {
        powerUp.cooldown = Math.max(0, powerUp.cooldown - 1000);
        updated = true;
      }
    });
    
    if (updated) {
      notifyPowerUpListeners();
    }
  }, 1000);
  
  // Update play time
  setInterval(() => {
    gameState.statistics.totalPlayTime += 1000;
  }, 1000);
  
  // Auto-save game state
  setInterval(async () => {
    await saveGameState();
  }, 30000); // Every 30 seconds
  
  // Reset daily claim status at midnight
  setInterval(() => {
    const now = new Date();
    const lastClaimDate = new Date(gameState.lastDailyClaim || 0);
    
    if (now.getDate() !== lastClaimDate.getDate() || 
        now.getMonth() !== lastClaimDate.getMonth() || 
        now.getFullYear() !== lastClaimDate.getFullYear()) {
      gameState.dailyClaimed = false;
      notifyStateListeners();
    }
  }, 60000); // Check every minute
}

/**
 * Validate game state for integrity
 */
function validateGameState() {
  // Ensure numeric values are valid
  if (typeof gameState.score !== 'number' || gameState.score < 0) {
    gameState.score = 0;
  }
  
  if (typeof gameState.combo !== 'number' || gameState.combo < 1) {
    gameState.combo = 1;
  }
  
  if (typeof gameState.totalSlaps !== 'number' || gameState.totalSlaps < 0) {
    gameState.totalSlaps = 0;
  }
  
  // Sanitize arrays
  if (!Array.isArray(gameState.achievements)) {
    gameState.achievements = [];
  }
  
  // Validate statistics object
  if (!gameState.statistics || typeof gameState.statistics !== 'object') {
    gameState.statistics = {
      totalPlayTime: 0,
      highestCombo: 0,
      totalTaps: 0,
      sessionsPlayed: 0
    };
  }
  
  console.log('✅ Game state validated');
}

/**
 * Reset game state to defaults
 */
function resetGameState() {
  gameState = {
    score: 0,
    combo: 1,
    lastSlapAt: 0,
    lastComboTick: 0,
    totalSlaps: 0,
    sessionStartTime: Date.now(),
    dailyClaimed: false,
    lastDailyClaim: 0,
    achievements: [],
    statistics: {
      totalPlayTime: 0,
      highestCombo: 0,
      totalTaps: 0,
      sessionsPlayed: 1
    }
  };
  
  saveGameState();
  notifyStateListeners();
}

/**
 * Save game state to persistence
 */
async function saveGameState() {
  try {
    await saveState(STATE_KEY, gameState);
  } catch (error) {
    console.error('Failed to save game state:', error);
  }
}

/**
 * Save power-ups state to persistence
 */
async function savePowerUpsState() {
  try {
    await saveState(POWERUPS_KEY, powerUpsState);
  } catch (error) {
    console.error('Failed to save power-ups state:', error);
  }
}

/**
 * Get current game state (read-only)
 */
export function getState() {
  return { 
    ...gameState, 
    powerUps: { ...powerUpsState }
  };
}

/**
 * Get power-ups state (read-only)
 */
export function getPowerUpsState() {
  return { ...powerUpsState };
}

/**
 * Event listener management
 */
export function onStateChange(callback) {
  stateListeners.push(callback);
}

export function onPowerUpChange(callback) {
  powerUpListeners.push(callback);
}

function notifyStateListeners() {
  const state = getState();
  stateListeners.forEach(callback => {
    try {
      callback(state);
    } catch (error) {
      console.error('Error in state listener:', error);
    }
  });
}

function notifyPowerUpListeners() {
  const powerUps = getPowerUpsState();
  powerUpListeners.forEach(callback => {
    try {
      callback(powerUps);
    } catch (error) {
      console.error('Error in power-up listener:', error);
    }
  });
}

/**
 * Debug and development functions
 */
export function getDebugInfo() {
  return {
    gameState,
    powerUpsState,
    tapsWindow: tapsWindow.length,
    scoreHistory: scoreHistory.slice(-10),
    sessionDuration: Date.now() - gameState.sessionStartTime
  };
}

export function addDebugScore(amount) {
  if (typeof amount === 'number' && amount > 0) {
    gameState.score += amount;
    notifyStateListeners();
  }
}

// Export for debugging in development
if (window.location.hostname === 'localhost') {
  window.gameStateDebug = {
    getState,
    addDebugScore,
    getDebugInfo,
    resetGameState
  };
}

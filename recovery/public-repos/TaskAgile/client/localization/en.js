/**
 * English Localization for No_Gas_Slaps™
 * Contains all user-facing text and messages
 */

// Localization data
const localizationData = {
  // UI Elements
  ui: {
    gameTitle: 'No_Gas_Slaps™',
    currentScore: 'Current Score',
    comboMultiplier: 'Combo Multiplier',
    mainAction: 'Main Game Action',
    slapButton: 'Slap to earn points',
    slapText: 'SLAP!',
    slapDescription: 'Tap this button rapidly to increase your score and build combo multipliers',
    dailyReward: 'Daily Reward',
    points: 'Points',
    claimReward: 'Claim Reward',
    dailyRewardDescription: 'Claim your daily bonus to boost your score',
    powerUps: 'Power-Ups',
    leaderboard: 'Leaderboard',
    refreshLeaderboard: 'Refresh leaderboard',
    shareScore: 'Share Score',
    toggleMute: 'Toggle sound on/off',
    showHelp: 'Show help and instructions',
    comboDisplay: 'x{multiplier} Combo',
    scoreAnnouncement: 'Current score: {score} points',
    comboAnnouncement: '{multiplier} times combo multiplier active',
    leaderboardEmpty: 'No scores yet - be the first to play!',
    rankPosition: 'Rank {rank}',
    playerScore: '{score} points',
    anonymousPlayer: 'Anonymous Player',
    leaderboardEntry: 'Rank {rank}: {name} with {score} points'
  },

  // Power-ups
  powerups: {
    doublePoints: {
      name: 'Double Points',
      description: 'Earn 2x points for 30 seconds'
    },
    rapidFire: {
      name: 'Rapid Fire',
      description: 'Increased tap rate limit for 15 seconds'
    },
    shield: {
      name: 'Shield',
      description: 'Protection from combo breaks for 1 minute'
    },
    magnet: {
      name: 'Score Magnet',
      description: 'Attracts bonus points for 20 seconds'
    },
    boost: {
      name: 'Mega Boost',
      description: 'Triple points for 10 seconds'
    }
  },

  // Error Messages
  errors: {
    loadingTimeout: 'Loading is taking longer than expected. Please refresh the page.',
    initializationFailed: 'Failed to start the game: {error}',
    slapFailed: 'Unable to process your slap. Please try again.',
    claimFailed: 'Unable to claim daily reward. Please try again later.',
    powerUpFailed: 'Power-up activation failed. Please try again.',
    leaderboardRefreshFailed: 'Unable to refresh leaderboard. Please check your connection.',
    shareFailed: 'Unable to share your score. Please try again.',
    networkError: 'Network connection error. Please check your internet.',
    storageError: 'Unable to save your progress. Storage may be full.',
    authError: 'Authentication failed. Please restart the app.',
    rateLimitError: 'You\'re tapping too fast! Please slow down.',
    cheatDetected: 'Suspicious activity detected. Please play fairly.',
    invalidData: 'Invalid game data detected. Please restart.',
    serverError: 'Server error occurred. Please try again later.',
    timeoutError: 'Request timed out. Please try again.',
    unknownError: 'An unexpected error occurred.'
  },

  // Success Messages
  success: {
    dailyRewardClaimed: 'Daily reward claimed! You earned {amount} points.',
    powerUpActivated: 'Power-up "{powerUp}" activated!',
    shareTextCopied: 'Share text copied to clipboard!',
    welcomeMessage: 'Welcome to No_Gas_Slaps™! Start tapping to earn points.',
    pwaInstalled: 'No_Gas_Slaps™ has been installed successfully!',
    leaderboardUpdated: 'Your score has been updated on the leaderboard!',
    achievementUnlocked: 'Achievement unlocked: {achievement}!',
    newHighScore: 'New high score! {score} points!',
    comboRecord: 'New combo record: {combo}x!',
    syncComplete: 'Game data synced successfully.',
    settingsSaved: 'Settings saved successfully.'
  },

  // Announcements (for screen readers)
  announcements: {
    gameReady: 'No_Gas_Slaps™ is ready to play!',
    appClosed: 'Application is closing. Your progress has been saved.',
    themeChanged: 'Theme changed to {theme} mode',
    scoreMilestone: 'Congratulations! You reached {score} points!',
    dailyRewardClaimed: 'Daily reward has been claimed successfully.',
    powerUpActivated: 'Power-up {powerUp} is now active.',
    onboardingComplete: 'Tutorial completed. You can now start playing.',
    shareTriggered: 'Share dialog opened.',
    leaderboardRefreshed: 'Leaderboard has been updated with latest scores.',
    comboStarted: 'Combo started! Keep tapping to increase your multiplier.',
    comboEnded: 'Combo ended. Final multiplier was {combo}x.',
    powerUpExpired: 'Power-up {powerUp} has expired.',
    newPlayerJoined: 'A new player has joined the leaderboard.',
    connectionRestored: 'Internet connection restored. Syncing data...',
    connectionLost: 'Internet connection lost. Playing in offline mode.',
    syncInProgress: 'Synchronizing your game data...',
    syncCompleted: 'Game data synchronized successfully.'
  },

  // Share Messages
  share: {
    title: 'No_Gas_Slaps™ - Telegram Mini Game',
    message: 'I just scored {score} points in No_Gas_Slaps™! 🚀 Can you beat my score?',
    url: 'Play now on Telegram!'
  },

  // Help and Instructions
  help: {
    gameObjective: 'Tap the slap button to build your score and climb the global leaderboard',
    comboSystem: 'Rapid tapping within 1.2 seconds maintains your combo multiplier',
    powerUpSystem: 'Unlock power-ups by reaching score milestones',
    antiCheat: 'Maximum 4 taps per second are allowed for fair play',
    dailyRewards: 'Claim your daily bonus to boost your score',
    accessibility: 'Use Space or Enter to slap, Tab to navigate',
    leaderboard: 'Compete with players worldwide for the top spot',
    offline: 'Play offline - your progress syncs when connection returns'
  },

  // Accessibility
  accessibility: {
    skipToMain: 'Skip to main game area',
    mainGameArea: 'Main game interface for No_Gas_Slaps™',
    navigationLandmark: 'Main navigation',
    gameControls: 'Game control buttons',
    scoreDisplay: 'Current score and statistics',
    leaderboardRegion: 'Global leaderboard rankings',
    powerUpControls: 'Power-up activation buttons',
    helpDialog: 'Help and instructions dialog',
    errorAlert: 'Error message',
    successNotification: 'Success notification',
    loadingStatus: 'Loading game content'
  },

  // Achievements
  achievements: {
    firstSlap: 'Welcome Slapper',
    score100: 'Century Slapper',
    score1000: 'Thousand Slapper',
    score10000: 'Ten Thousand Slapper',
    combo10: 'Combo Master',
    combo25: 'Combo Legend',
    dailyPlayer: 'Daily Dedication',
    powerUpUser: 'Power Player',
    leaderboardTop10: 'Top Ten',
    leaderboardTop3: 'Podium Finisher',
    leaderboardFirst: 'Champion Slapper'
  },

  // Time and Date
  time: {
    seconds: 'seconds',
    minutes: 'minutes',
    hours: 'hours',
    days: 'days',
    timeLeft: '{time} left',
    cooldown: 'Cooldown: {time}',
    lastPlayed: 'Last played {time} ago',
    nextReward: 'Next reward in {time}'
  },

  // Tutorial/Onboarding
  tutorial: {
    welcome: 'Welcome to No_Gas_Slaps™!',
    step1: 'Tap the slap button to earn points',
    step2: 'Build combos by tapping rapidly',
    step3: 'Unlock and activate power-ups',
    step4: 'Compete on the global leaderboard',
    step5: 'Claim daily rewards',
    getStarted: 'Ready to start slapping?',
    skipTutorial: 'Skip tutorial',
    nextStep: 'Next',
    previousStep: 'Previous',
    finishTutorial: 'Start Playing!'
  },

  // Settings
  settings: {
    audio: 'Audio Settings',
    masterVolume: 'Master Volume',
    sfxVolume: 'Sound Effects',
    musicVolume: 'Background Music',
    muteAll: 'Mute All Sounds',
    vibration: 'Vibration',
    notifications: 'Notifications',
    language: 'Language',
    theme: 'Theme',
    darkMode: 'Dark Mode',
    lightMode: 'Light Mode',
    autoMode: 'Auto (System)',
    resetData: 'Reset Game Data',
    exportData: 'Export Progress',
    importData: 'Import Progress'
  },

  // Notifications
  notifications: {
    dailyRewardReady: 'Your daily reward is ready to claim!',
    powerUpReady: 'New power-up unlocked!',
    leaderboardUpdate: 'You moved up in the leaderboard!',
    achievementEarned: 'Achievement earned: {achievement}',
    comboRecord: 'New personal combo record!',
    scoreRecord: 'New personal high score!',
    weeklyChallenge: 'New weekly challenge available!',
    eventStarted: 'Special event has begun!',
    maintenanceWarning: 'Scheduled maintenance in {time}',
    updateAvailable: 'Game update available!'
  },

  // Loading States
  loading: {
    initializing: 'Initializing No_Gas_Slaps™...',
    loadingGame: 'Loading game data...',
    connectingServer: 'Connecting to server...',
    syncingProgress: 'Syncing your progress...',
    updatingLeaderboard: 'Updating leaderboard...',
    processingReward: 'Processing your reward...',
    activatingPowerUp: 'Activating power-up...',
    savingProgress: 'Saving your progress...',
    loadingAudio: 'Loading audio files...',
    preparingGame: 'Preparing your game...'
  },

  // Offline Messages
  offline: {
    noConnection: 'No internet connection',
    playingOffline: 'Playing in offline mode',
    willSyncLater: 'Progress will sync when connection returns',
    reconnecting: 'Attempting to reconnect...',
    reconnected: 'Connection restored!',
    syncPending: '{count} items waiting to sync',
    lastSync: 'Last synced: {time}',
    offlineProgress: 'Offline progress saved locally'
  }
};

// Current language
let currentLanguage = 'en';

/**
 * Load localization data
 */
export async function loadLocalization(language = 'en') {
  try {
    currentLanguage = language;
    console.log(`✅ Localization loaded: ${language}`);
    return localizationData;
  } catch (error) {
    console.error('Error loading localization:', error);
    return localizationData; // Fallback to default
  }
}

/**
 * Get localized text with parameter substitution
 */
export function t(key, params = {}) {
  try {
    // Navigate through nested object using dot notation
    const keys = key.split('.');
    let value = localizationData;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        console.warn(`Translation key not found: ${key}`);
        return key; // Return key as fallback
      }
    }
    
    // Handle parameter substitution
    if (typeof value === 'string' && Object.keys(params).length > 0) {
      return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
        return params[paramKey] !== undefined ? params[paramKey] : match;
      });
    }
    
    return value;
    
  } catch (error) {
    console.error('Error getting translation:', error);
    return key;
  }
}

/**
 * Get current language
 */
export function getCurrentLanguage() {
  return currentLanguage;
}

/**
 * Format number for display
 */
export function formatNumber(num, options = {}) {
  try {
    if (typeof num !== 'number') return '0';
    
    const formatter = new Intl.NumberFormat(currentLanguage, {
      minimumFractionDigits: options.decimals || 0,
      maximumFractionDigits: options.decimals || 0,
      notation: options.compact ? 'compact' : 'standard',
      compactDisplay: 'short'
    });
    
    return formatter.format(num);
    
  } catch (error) {
    console.error('Error formatting number:', error);
    return num.toString();
  }
}

/**
 * Format time duration
 */
export function formatDuration(milliseconds) {
  try {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return t('time.days', { count: days });
    } else if (hours > 0) {
      return t('time.hours', { count: hours });
    } else if (minutes > 0) {
      return t('time.minutes', { count: minutes });
    } else {
      return t('time.seconds', { count: seconds });
    }
    
  } catch (error) {
    console.error('Error formatting duration:', error);
    return '0s';
  }
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(timestamp) {
  try {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) { // Less than 1 minute
      return t('time.justNow') || 'Just now';
    } else if (diff < 3600000) { // Less than 1 hour
      const minutes = Math.floor(diff / 60000);
      return t('time.minutesAgo', { count: minutes }) || `${minutes}m ago`;
    } else if (diff < 86400000) { // Less than 1 day
      const hours = Math.floor(diff / 3600000);
      return t('time.hoursAgo', { count: hours }) || `${hours}h ago`;
    } else {
      const days = Math.floor(diff / 86400000);
      return t('time.daysAgo', { count: days }) || `${days}d ago`;
    }
    
  } catch (error) {
    console.error('Error formatting relative time:', error);
    return '';
  }
}

/**
 * Pluralization helper
 */
export function plural(count, singular, plural) {
  return count === 1 ? singular : plural;
}

/**
 * Check if text direction is RTL
 */
export function isRTL() {
  const rtlLanguages = ['ar', 'he', 'fa', 'ur'];
  return rtlLanguages.includes(currentLanguage);
}

/**
 * Get text direction
 */
export function getTextDirection() {
  return isRTL() ? 'rtl' : 'ltr';
}

/**
 * Format currency (for future monetization)
 */
export function formatCurrency(amount, currency = 'USD') {
  try {
    const formatter = new Intl.NumberFormat(currentLanguage, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2
    });
    
    return formatter.format(amount);
    
  } catch (error) {
    console.error('Error formatting currency:', error);
    return `${amount} ${currency}`;
  }
}

/**
 * Get localized date format
 */
export function formatDate(date, options = {}) {
  try {
    const formatter = new Intl.DateTimeFormat(currentLanguage, {
      year: options.year || 'numeric',
      month: options.month || 'short',
      day: options.day || 'numeric',
      hour: options.hour,
      minute: options.minute,
      timeZoneName: options.timeZone ? 'short' : undefined
    });
    
    return formatter.format(new Date(date));
    
  } catch (error) {
    console.error('Error formatting date:', error);
    return new Date(date).toLocaleDateString();
  }
}

// Export all localization functions
export {
  localizationData,
  currentLanguage
};

// Make available globally for debugging
if (typeof window !== 'undefined') {
  window.localization = {
    t,
    formatNumber,
    formatDuration,
    formatRelativeTime,
    formatCurrency,
    formatDate,
    getCurrentLanguage,
    isRTL,
    getTextDirection
  };
}


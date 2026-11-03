
/**
 * English Localization Module
 * Provides all text content and translations for the game
 */

const translations = {
  // General UI
  game: {
    title: "No_Gas_Slaps™",
    subtitle: "Telegram Mini App",
    loading: "Loading No_Gas_Slaps™...",
    ready: "Game Ready!",
    startGame: "Start Slapping!",
    continue: "Continue"
  },

  // Actions
  actions: {
    slap: "SLAP!",
    claim: "Claim",
    share: "Share Score",
    help: "Help",
    close: "Close",
    gotIt: "Got It!",
    refresh: "Refresh",
    activate: "Activate",
    upgrade: "Upgrade"
  },

  // Score and Progress
  score: {
    points: "Points",
    combo: "Combo",
    level: "Level {level}",
    next: "Next: {points} pts",
    total: "Total Score",
    highest: "Highest Score",
    current: "Current Score"
  },

  // Power-ups
  powerups: {
    title: "Power-ups",
    doublePoints: {
      name: "Double Points",
      description: "2x points for 30 seconds",
      unlock: "Unlock at {points} pts"
    },
    rapidFire: {
      name: "Rapid Fire",
      description: "Faster tapping allowed",
      unlock: "Unlock at {points} pts"
    },
    shield: {
      name: "Combo Shield",
      description: "Protect your combo streak",
      unlock: "Unlock at {points} pts"
    },
    magnet: {
      name: "Point Magnet",
      description: "Auto-collect bonus points",
      unlock: "Unlock at {points} pts"
    },
    boost: {
      name: "Mega Boost",
      description: "3x point multiplier",
      unlock: "Unlock at {points} pts"
    },
    status: {
      locked: "Locked",
      ready: "Ready to use!",
      active: "Active ({seconds}s)",
      cooldown: "Cooldown ({seconds}s)"
    }
  },

  // Achievements
  achievements: {
    title: "Achievement Unlocked!",
    score_100: "First Century",
    score_500: "Getting Warmed Up",
    score_1000: "Four Figures",
    score_5000: "Slap Master",
    score_10000: "Elite Slapper",
    score_50000: "Legendary Status",
    score_100000: "Ultimate Champion",
    combo_10: "Combo Master",
    combo_25: "Combo Beast",
    daily_1: "Daily Dedication",
    daily_7: "Weekly Warrior",
    daily_30: "Monthly Legend"
  },

  // Leaderboard
  leaderboard: {
    title: "🏆 Leaderboard",
    rank: "Rank #{rank}",
    you: "You",
    noPlayers: "No players yet. Be the first!",
    loading: "Loading rankings...",
    refreshing: "Refreshing...",
    top: "Top Players",
    global: "Global",
    friends: "Friends"
  },

  // Daily Rewards
  daily: {
    title: "Daily Reward",
    description: "Come back every day for bonus points!",
    claim: "Claim {points} pts",
    claimed: "Claimed Today!",
    streak: "Day {day} Streak!",
    bonus: "+{points} Streak Bonus",
    comeback: "Welcome back!"
  },

  // Onboarding
  onboarding: {
    welcome: "Welcome to No_Gas_Slaps™!",
    step1: {
      title: "Tap to Slap",
      description: "Tap the slap button to earn points and build combos"
    },
    step2: {
      title: "Unlock Power-ups",
      description: "Reach milestones to unlock powerful abilities"
    },
    step3: {
      title: "Compete",
      description: "Climb the leaderboard and share your achievements"
    },
    tips: {
      fastTapping: "Tip: Tap quickly to build combo multipliers!",
      powerUps: "Tip: Use power-ups strategically for maximum points!",
      dailyReward: "Tip: Don't forget your daily reward!"
    }
  },

  // Help
  help: {
    title: "How to Play",
    gameplay: {
      title: "🎯 Basic Gameplay",
      content: "Tap the slap button to earn points. Build combos by tapping quickly!"
    },
    powerups: {
      title: "⚡ Power-ups",
      content: "Unlock special abilities by reaching point milestones. Each power-up has a cooldown period."
    },
    leaderboard: {
      title: "🏆 Leaderboard",
      content: "Compete with other players and climb to the top of the rankings!"
    },
    daily: {
      title: "🎁 Daily Rewards",
      content: "Come back daily to claim bonus points and maintain your streak."
    },
    sharing: {
      title: "📱 Sharing",
      content: "Share your high scores with friends and challenge them to beat you!"
    }
  },

  // Notifications and Messages
  messages: {
    welcome: "Welcome to No_Gas_Slaps™! Start tapping to earn points!",
    achievement: "🏆 Achievement unlocked: {achievement}!",
    powerUpUnlocked: "🚀 New power-up unlocked: {powerup}!",
    powerUpActivated: "⚡ {powerup} activated!",
    dailyRewardClaimed: "🎁 Daily reward claimed: +{points} points!",
    comboBreak: "💔 Combo broken! Keep tapping!",
    highScore: "🎉 New high score: {score} points!",
    levelUp: "📈 Level up! You're now level {level}!",
    shareScore: "I just scored {score} points in No_Gas_Slaps™! 🚀 Can you beat my score?",
    rateLimited: "Whoa! Slow down there, speed demon! 😅"
  },

  // Errors
  errors: {
    general: "Something went wrong. Please try again.",
    network: "Connection error. Check your internet connection.",
    initializationFailed: "Failed to initialize the game: {error}",
    saveError: "Failed to save your progress.",
    loadError: "Failed to load your progress.",
    powerUpError: "Failed to activate power-up: {error}",
    leaderboardError: "Failed to update leaderboard.",
    audioError: "Audio system unavailable.",
    tooFast: "Tap rate too high. Please slow down!",
    invalidData: "Invalid game data detected.",
    quotaExceeded: "Storage space full. Please clear some data.",
    offline: "You're offline. Some features may be limited."
  },

  // Success Messages
  success: {
    saved: "Progress saved successfully!",
    shared: "Score shared successfully!",
    powerUpActivated: "Power-up activated!",
    dailyRewardClaimed: "Daily reward claimed!",
    leaderboardUpdated: "Leaderboard updated!",
    settingsUpdated: "Settings updated!",
    connected: "Connection restored!"
  },

  // Accessibility
  a11y: {
    skipToMain: "Skip to main game",
    slapButtonDescription: "Main game button. Tap repeatedly to earn points and build combos.",
    scoreAnnouncement: "Your score is now {score} points",
    comboAnnouncement: "Combo multiplier: {combo} times",
    powerUpAvailable: "Power-up {powerup} is now available",
    achievementUnlocked: "Achievement unlocked: {achievement}",
    leaderboardUpdate: "You are now rank {rank} on the leaderboard",
    muteToggle: "Toggle sound on or off",
    helpButton: "Open help and instructions",
    refreshButton: "Refresh leaderboard data"
  },

  // Time and Numbers
  time: {
    seconds: "{count}s",
    minutes: "{count}m",
    hours: "{count}h",
    days: "{count}d",
    justNow: "Just now",
    ago: "{time} ago"
  },

  numbers: {
    thousand: "K",
    million: "M",
    billion: "B",
    trillion: "T"
  },

  // Social
  social: {
    shareTitle: "No_Gas_Slaps™ - High Score!",
    shareText: "I just scored {score} points in No_Gas_Slaps™! Can you beat my score?",
    inviteFriends: "Invite friends to compete!",
    challenge: "Challenge your friends!",
    celebrate: "🎉 Congratulations! 🎉"
  },

  // Status
  status: {
    online: "Online",
    offline: "Offline",
    connecting: "Connecting...",
    syncing: "Syncing...",
    updated: "Updated",
    loading: "Loading...",
    error: "Error",
    ready: "Ready"
  }
};

/**
 * Get translated text with parameter substitution
 */
export function t(key, params = {}) {
  const keys = key.split('.');
  let value = translations;
  
  for (const k of keys) {
    value = value[k];
    if (value === undefined) {
      console.warn(`Translation key not found: ${key}`);
      return key;
    }
  }
  
  // Substitute parameters
  if (typeof value === 'string' && Object.keys(params).length > 0) {
    return value.replace(/\{(\w+)\}/g, (match, param) => {
      return params[param] !== undefined ? params[param] : match;
    });
  }
  
  return value;
}

/**
 * Format numbers with appropriate suffixes
 */
export function formatNumber(num) {
  if (num < 1000) return num.toString();
  if (num < 1000000) return (num / 1000).toFixed(1) + t('numbers.thousand');
  if (num < 1000000000) return (num / 1000000).toFixed(1) + t('numbers.million');
  if (num < 1000000000000) return (num / 1000000000).toFixed(1) + t('numbers.billion');
  return (num / 1000000000000).toFixed(1) + t('numbers.trillion');
}

/**
 * Format time durations
 */
export function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return t('time.days', { count: days });
  if (hours > 0) return t('time.hours', { count: hours });
  if (minutes > 0) return t('time.minutes', { count: minutes });
  if (seconds > 0) return t('time.seconds', { count: seconds });
  return t('time.justNow');
}

/**
 * Load localization based on user preferences
 */
export async function loadLocalization(locale = 'en') {
  // Currently only English is supported
  // Future: Load different translation files based on locale
  
  console.log(`📖 Localization loaded: ${locale}`);
  return translations;
}

/**
 * Get all available translations for debugging
 */
export function getTranslations() {
  return translations;
}

// Export for debugging
if (window.location.hostname === 'localhost') {
  window.localizationDebug = {
    translations,
    t,
    formatNumber,
    formatTime
  };
}

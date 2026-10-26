/**
 * Telegram Web App API Integration Module
 * Handles all Telegram-specific functionality and WebApp SDK integration
 */

let tg = null;
let user = null;
let theme = 'light';
let isReady = false;

// Event listeners
const readyListeners = [];
const closeListeners = [];
const themeListeners = [];

/**
 * Initialize Telegram Web App SDK
 */
export async function initTelegram() {
  // Check if running inside Telegram
  if (!window.Telegram || !window.Telegram.WebApp) {
    console.warn('Telegram Web App SDK not found. Some features may be limited.');
    // Set fallback values for development/testing
    user = { id: 'dev_user', first_name: 'Developer', username: 'dev' };
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return;
  }

  tg = window.Telegram.WebApp;
  
  // Initialize the web app
  tg.ready();
  
  // Get user data
  user = tg.initDataUnsafe?.user || null;
  theme = tg.colorScheme || 'light';
  
  // Set up main button if needed
  tg.MainButton.text = "Share Score";
  tg.MainButton.color = "#00ff88";
  
  // Set up back button
  if (tg.BackButton) {
    tg.BackButton.show();
    tg.BackButton.onClick(() => {
      // Handle back navigation
      const helpOverlay = document.getElementById('help-overlay');
      const onboardingOverlay = document.getElementById('onboarding-overlay');
      
      if (helpOverlay && !helpOverlay.classList.contains('hidden')) {
        helpOverlay.classList.add('hidden');
        return;
      }
      
      if (onboardingOverlay && !onboardingOverlay.classList.contains('hidden')) {
        onboardingOverlay.classList.add('hidden');
        return;
      }
      
      // Default back behavior
      tg.close();
    });
  }

  // Set viewport height
  tg.expand();
  
  // Disable vertical swipes if available
  if (tg.disableVerticalSwipes) {
    tg.disableVerticalSwipes();
  }

  // Set up event listeners
  if (tg.onEvent) {
    tg.onEvent('themeChanged', () => {
      theme = tg.colorScheme || 'light';
      themeListeners.forEach(callback => callback(theme));
    });

    tg.onEvent('mainButtonClicked', () => {
      // Handle main button click (share functionality)
      const state = window.NoGasSlaps?.getState?.() || { score: 0 };
      shareScore(state.score);
    });

    tg.onEvent('viewportChanged', () => {
      // Handle viewport changes
      console.log('Viewport changed:', tg.viewportHeight, tg.viewportStableHeight);
    });

    tg.onEvent('settingsButtonClicked', () => {
      // Show help/settings
      const event = new CustomEvent('showHelp');
      document.dispatchEvent(event);
    });
  }

  // Enable settings button
  if (tg.SettingsButton) {
    tg.SettingsButton.show();
  }

  isReady = true;
  readyListeners.forEach(callback => callback());
}

/**
 * Get current user information
 */
export function getUser() {
  return user;
}

/**
 * Get current theme
 */
export function getTheme() {
  return theme;
}

/**
 * Check if running inside Telegram
 */
export function isInsideTelegram() {
  return Boolean(window.Telegram?.WebApp && tg);
}

/**
 * Get Telegram Web App instance
 */
export function getTelegramWebApp() {
  return tg;
}

/**
 * Show main button with custom text
 */
export function showMainButton(text = "Share Score", onClick = null) {
  if (!tg?.MainButton) return;
  
  tg.MainButton.text = text;
  tg.MainButton.show();
  
  if (onClick) {
    tg.MainButton.onClick(onClick);
  }
}

/**
 * Hide main button
 */
export function hideMainButton() {
  if (!tg?.MainButton) return;
  tg.MainButton.hide();
}

/**
 * Show haptic feedback
 */
export function hapticFeedback(type = 'impact', style = 'light') {
  if (!tg?.HapticFeedback) return;
  
  try {
    switch (type) {
      case 'impact':
        tg.HapticFeedback.impactOccurred(style); // light, medium, heavy
        break;
      case 'notification':
        tg.HapticFeedback.notificationOccurred(style); // error, success, warning
        break;
      case 'selection':
        tg.HapticFeedback.selectionChanged();
        break;
    }
  } catch (error) {
    console.warn('Haptic feedback failed:', error);
  }
}

/**
 * Share score via Telegram
 */
export function shareScore(score) {
  if (!isInsideTelegram()) {
    // Fallback sharing for non-Telegram environments
    if (navigator.share) {
      navigator.share({
        title: 'No_Gas_Slaps™',
        text: `I just scored ${score} points in No_Gas_Slaps™! Can you beat my score?`,
        url: window.location.href
      });
    } else {
      // Fallback to clipboard
      const shareText = `I just scored ${score} points in No_Gas_Slaps™! Can you beat my score? ${window.location.href}`;
      navigator.clipboard.writeText(shareText);
    }
    return;
  }

  // Use Telegram sharing
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(`I just scored ${score} points in No_Gas_Slaps™! 🚀 Can you beat my score?`)}`;
  
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(shareUrl);
  } else {
    window.open(shareUrl, '_blank');
  }
}

/**
 * Open invoice for in-app purchases
 */
export function openInvoice(invoiceUrl) {
  if (!tg?.openInvoice) {
    console.warn('Invoice functionality not available');
    return;
  }
  
  tg.openInvoice(invoiceUrl, (status) => {
    console.log('Invoice status:', status);
    // Handle payment status
    const event = new CustomEvent('paymentResult', { detail: { status } });
    document.dispatchEvent(event);
  });
}

/**
 * Send data to bot
 */
export function sendDataToBot(data) {
  if (!tg?.sendData) {
    console.warn('sendData not available');
    return;
  }
  
  try {
    tg.sendData(JSON.stringify(data));
  } catch (error) {
    console.error('Failed to send data to bot:', error);
  }
}

/**
 * Close the web app
 */
export function closeApp() {
  if (tg?.close) {
    tg.close();
  } else {
    // Fallback for non-Telegram environments
    window.close();
  }
}

/**
 * Request contact access
 */
export function requestContact() {
  if (!tg?.requestContact) {
    console.warn('Contact request not available');
    return Promise.reject(new Error('Contact access not available'));
  }
  
  return new Promise((resolve, reject) => {
    tg.requestContact((contact) => {
      if (contact) {
        resolve(contact);
      } else {
        reject(new Error('Contact access denied'));
      }
    });
  });
}

/**
 * Event listeners
 */
export function onReady(callback) {
  if (isReady) {
    callback();
  } else {
    readyListeners.push(callback);
  }
}

export function onClose(callback) {
  closeListeners.push(callback);
  
  // Also listen for browser events
  window.addEventListener('beforeunload', callback);
  
  // Telegram-specific close event
  if (tg?.onEvent) {
    tg.onEvent('web_app_close', callback);
  }
}

export function onThemeChanged(callback) {
  themeListeners.push(callback);
}

/**
 * Get platform information
 */
export function getPlatform() {
  if (!tg) return 'web';
  
  return tg.platform || 'unknown';
}

/**
 * Get app version
 */
export function getVersion() {
  if (!tg) return '1.0';
  
  return tg.version || '1.0';
}

/**
 * Check if specific features are available
 */
export function isFeatureAvailable(feature) {
  if (!tg) return false;
  
  const features = {
    haptic: Boolean(tg.HapticFeedback),
    mainButton: Boolean(tg.MainButton),
    backButton: Boolean(tg.BackButton),
    settingsButton: Boolean(tg.SettingsButton),
    invoice: Boolean(tg.openInvoice),
    contact: Boolean(tg.requestContact),
    location: Boolean(tg.requestLocation),
    writeAccess: Boolean(tg.requestWriteAccess)
  };
  
  return features[feature] || false;
}

/**
 * Set app header color
 */
export function setHeaderColor(color) {
  if (tg?.setHeaderColor) {
    tg.setHeaderColor(color);
  }
}

/**
 * Set app background color
 */
export function setBackgroundColor(color) {
  if (tg?.setBackgroundColor) {
    tg.setBackgroundColor(color);
  }
}

/**
 * Get safe area insets
 */
export function getSafeAreaInsets() {
  if (!tg) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
  
  return {
    top: tg.safeAreaInset?.top || 0,
    bottom: tg.safeAreaInset?.bottom || 0,
    left: tg.safeAreaInset?.left || 0,
    right: tg.safeAreaInset?.right || 0
  };
}

/**
 * Ready check
 */
export function isTelegramReady() {
  return isReady;
}

/**
 * Error Management Module
 * Handles error display, logging, and user feedback
 */

import { logError, logDev } from './testing.js';
import { sanitizeInput } from './security.js';

// Error state
let currentError = null;
let currentSuccess = null;
let errorHistory = [];
let errorTimeout = null;
let successTimeout = null;

// Event listeners
const errorListeners = [];

// Error configuration
const MAX_ERROR_HISTORY = 50;
const ERROR_DISPLAY_DURATION = 5000;
const SUCCESS_DISPLAY_DURATION = 3000;

/**
 * Show error message to user
 */
export function showError(message, details = null) {
  if (!message) return;

  // Clear any existing success message
  clearSuccess();

  // Sanitize the error message
  const sanitizedMessage = sanitizeInput(message.toString());
  
  // Create error object
  const error = {
    id: generateErrorId(),
    message: sanitizedMessage,
    details: details ? sanitizeInput(details.toString()) : null,
    timestamp: Date.now(),
    type: 'error'
  };

  // Add to history
  addToErrorHistory(error);

  // Set current error
  currentError = error;

  // Log the error
  logError('User error displayed:', error.message, details);

  // Notify listeners
  notifyErrorListeners();

  // Auto-clear error after timeout
  if (errorTimeout) {
    clearTimeout(errorTimeout);
  }
  
  errorTimeout = setTimeout(() => {
    clearError();
  }, ERROR_DISPLAY_DURATION);

  // Announce to screen readers
  announceToScreenReader(sanitizedMessage, 'assertive');

  return error.id;
}

/**
 * Show success message to user
 */
export function showSuccess(message, duration = SUCCESS_DISPLAY_DURATION) {
  if (!message) return;

  // Clear any existing error
  clearError();

  // Sanitize the success message
  const sanitizedMessage = sanitizeInput(message.toString());

  // Create success object
  const success = {
    id: generateErrorId(),
    message: sanitizedMessage,
    timestamp: Date.now(),
    type: 'success'
  };

  // Set current success
  currentSuccess = success;

  // Log the success
  logDev('Success message displayed:', success.message);

  // Notify listeners
  notifyErrorListeners();

  // Auto-clear success after timeout
  if (successTimeout) {
    clearTimeout(successTimeout);
  }
  
  successTimeout = setTimeout(() => {
    clearSuccess();
  }, duration);

  // Announce to screen readers
  announceToScreenReader(sanitizedMessage, 'polite');

  return success.id;
}

/**
 * Show warning message to user
 */
export function showWarning(message, details = null) {
  if (!message) return;

  const sanitizedMessage = sanitizeInput(message.toString());
  
  const warning = {
    id: generateErrorId(),
    message: sanitizedMessage,
    details: details ? sanitizeInput(details.toString()) : null,
    timestamp: Date.now(),
    type: 'warning'
  };

  addToErrorHistory(warning);
  logDev('Warning displayed:', warning.message, details);

  // Show as error but with warning styling
  currentError = warning;
  notifyErrorListeners();

  // Auto-clear after shorter timeout
  if (errorTimeout) {
    clearTimeout(errorTimeout);
  }
  
  errorTimeout = setTimeout(() => {
    clearError();
  }, 3000);

  announceToScreenReader(sanitizedMessage, 'polite');
  return warning.id;
}

/**
 * Clear current error
 */
export function clearError() {
  if (currentError) {
    currentError = null;
    
    if (errorTimeout) {
      clearTimeout(errorTimeout);
      errorTimeout = null;
    }
    
    notifyErrorListeners();
  }
}

/**
 * Clear current success message
 */
export function clearSuccess() {
  if (currentSuccess) {
    currentSuccess = null;
    
    if (successTimeout) {
      clearTimeout(successTimeout);
      successTimeout = null;
    }
    
    notifyErrorListeners();
  }
}

/**
 * Get current error
 */
export function getError() {
  return currentError?.message || null;
}

/**
 * Get current success message
 */
export function getCurrentSuccess() {
  return currentSuccess?.message || null;
}

/**
 * Get error details
 */
export function getErrorDetails() {
  return currentError?.details || null;
}

/**
 * Get error type
 */
export function getErrorType() {
  return currentError?.type || null;
}

/**
 * Check if error is currently displayed
 */
export function hasError() {
  return currentError !== null;
}

/**
 * Check if success is currently displayed
 */
export function hasSuccess() {
  return currentSuccess !== null;
}

/**
 * Get error history
 */
export function getErrorHistory() {
  return [...errorHistory];
}

/**
 * Clear error history
 */
export function clearErrorHistory() {
  errorHistory = [];
  logDev('Error history cleared');
}

/**
 * Handle async errors with user-friendly messages
 */
export function handleAsyncError(promise, fallbackMessage = 'An unexpected error occurred') {
  if (!promise || typeof promise.catch !== 'function') {
    showError('Invalid operation attempted');
    return Promise.reject(new Error('Invalid promise provided'));
  }

  return promise.catch(error => {
    let userMessage = fallbackMessage;
    let details = null;

    // Extract user-friendly error messages
    if (error) {
      if (typeof error === 'string') {
        userMessage = error;
      } else if (error.message) {
        userMessage = error.message;
        details = error.stack;
      } else if (error.toString && typeof error.toString === 'function') {
        userMessage = error.toString();
      }
    }

    // Show error to user
    showError(userMessage, details);

    // Re-throw for further handling if needed
    throw error;
  });
}

/**
 * Validate and show network errors
 */
export function handleNetworkError(error) {
  let message = 'Network error occurred';
  
  if (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      message = 'Unable to connect to server. Please check your internet connection.';
    } else if (error.status) {
      switch (error.status) {
        case 400:
          message = 'Invalid request. Please try again.';
          break;
        case 401:
          message = 'Authentication required. Please log in again.';
          break;
        case 403:
          message = 'Access denied. You do not have permission for this action.';
          break;
        case 404:
          message = 'Resource not found. Please try again later.';
          break;
        case 429:
          message = 'Too many requests. Please wait a moment and try again.';
          break;
        case 500:
          message = 'Server error. Please try again later.';
          break;
        case 503:
          message = 'Service temporarily unavailable. Please try again later.';
          break;
        default:
          message = `Network error (${error.status}). Please try again.`;
      }
    } else if (error.message) {
      message = error.message;
    }
  }

  showError(message);
  return message;
}

/**
 * Add error to history
 */
function addToErrorHistory(errorObj) {
  errorHistory.unshift(errorObj);
  
  // Limit history size
  if (errorHistory.length > MAX_ERROR_HISTORY) {
    errorHistory = errorHistory.slice(0, MAX_ERROR_HISTORY);
  }
}

/**
 * Generate unique error ID
 */
function generateErrorId() {
  return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Announce message to screen readers
 */
function announceToScreenReader(message, priority = 'polite') {
  const announcer = document.getElementById('sr-announcer');
  if (announcer) {
    // Set aria-live priority
    announcer.setAttribute('aria-live', priority);
    
    // Clear and set message
    announcer.textContent = '';
    setTimeout(() => {
      announcer.textContent = message;
    }, 100);
    
    // Clear after announcement
    setTimeout(() => {
      announcer.textContent = '';
      announcer.setAttribute('aria-live', 'polite');
    }, 3000);
  }
}

/**
 * Event listener management
 */
export function onErrorChange(callback) {
  if (typeof callback === 'function') {
    errorListeners.push(callback);
  }
}

export function removeErrorListener(callback) {
  const index = errorListeners.indexOf(callback);
  if (index > -1) {
    errorListeners.splice(index, 1);
  }
}

function notifyErrorListeners() {
  errorListeners.forEach(callback => {
    try {
      callback({
        error: currentError,
        success: currentSuccess,
        hasError: hasError(),
        hasSuccess: hasSuccess()
      });
    } catch (error) {
      logError('Error in error listener:', error);
    }
  });
}

/**
 * Global error handler setup
 */
export function setupGlobalErrorHandling() {
  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    logError('Unhandled promise rejection:', error);
    
    // Show user-friendly error
    showError('An unexpected error occurred. The issue has been logged.');
    
    // Prevent console error (optional)
    event.preventDefault();
  });

  // Handle global JavaScript errors
  window.addEventListener('error', (event) => {
    logError('Global JavaScript error:', event.error || event.message);
    
    // Only show error to user if it's not already handled
    if (!hasError()) {
      showError('A technical error occurred. Please refresh the page if problems persist.');
    }
  });

  logDev('Global error handling setup complete');
}

/**
 * Error recovery utilities
 */
export function retryOperation(operation, maxRetries = 3, delay = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function attempt() {
      attempts++;
      
      Promise.resolve(operation())
        .then(resolve)
        .catch(error => {
          if (attempts < maxRetries) {
            logDev(`Operation failed (attempt ${attempts}/${maxRetries}), retrying in ${delay}ms...`);
            setTimeout(attempt, delay * attempts); // Exponential backoff
          } else {
            logError(`Operation failed after ${maxRetries} attempts:`, error);
            reject(error);
          }
        });
    }

    attempt();
  });
}

/**
 * Debounced error showing to prevent spam
 */
export const debouncedShowError = (() => {
  let timeout = null;
  let pendingMessage = null;

  return (message, debounceTime = 500) => {
    pendingMessage = message;
    
    if (timeout) {
      clearTimeout(timeout);
    }
    
    timeout = setTimeout(() => {
      if (pendingMessage) {
        showError(pendingMessage);
        pendingMessage = null;
      }
      timeout = null;
    }, debounceTime);
  };
})();

/**
 * Cleanup function
 */
export function cleanup() {
  clearError();
  clearSuccess();
  clearErrorHistory();
  errorListeners.length = 0;
  
  if (errorTimeout) {
    clearTimeout(errorTimeout);
    errorTimeout = null;
  }
  
  if (successTimeout) {
    clearTimeout(successTimeout);
    successTimeout = null;
  }
}

// Initialize global error handling when module loads
if (typeof window !== 'undefined') {
  setupGlobalErrorHandling();
}

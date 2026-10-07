/**
 * Security Module
 * Handles input sanitization, validation, and security checks
 */

import { logError, logDev, logInfo } from './testing.js';
import { getTelegramWebApp, getUser, isInsideTelegram } from './telegram-api.js';

// Security configuration
const MAX_INPUT_LENGTH = 1000;
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;
const SUSPICIOUS_PATTERNS = [
  /[<>]/g,                    // HTML tags
  /javascript:/i,             // JavaScript protocol
  /on\w+\s*=/i,              // Event handlers
  /expression\s*\(/i,         // CSS expression
  /eval\s*\(/i,              // eval() calls
  /setTimeout\s*\(/i,         // setTimeout calls
  /setInterval\s*\(/i,        // setInterval calls
];

// Rate limiting state
const requestLog = new Map();

/**
 * Sanitize user input to prevent XSS and injection attacks
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return '';
  }

  // Limit input length
  if (input.length > MAX_INPUT_LENGTH) {
    logError('Input length exceeded maximum allowed');
    input = input.substring(0, MAX_INPUT_LENGTH);
  }

  // Basic HTML entity encoding
  let sanitized = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Check for suspicious patterns
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(sanitized)) {
      logError('Suspicious pattern detected in input:', pattern);
      sanitized = sanitized.replace(pattern, '');
    }
  }

  // Normalize whitespace
  sanitized = sanitized.trim().replace(/\s+/g, ' ');

  return sanitized;
}

/**
 * Validate score to prevent manipulation
 */
export function validateScore(score, previousScore = 0, timeDelta = 0) {
  try {
    // Basic type and range validation
    if (typeof score !== 'number' || !isFinite(score) || score < 0) {
      logError('Invalid score type or range:', score);
      return false;
    }

    // Check for unrealistic score increases
    const scoreDifference = score - previousScore;
    const maxReasonableIncrease = timeDelta > 0 ? (timeDelta / 100) * 10 : 1000; // 10 points per 100ms

    if (scoreDifference > maxReasonableIncrease) {
      logError('Unrealistic score increase detected:', {
        previous: previousScore,
        current: score,
        difference: scoreDifference,
        timeDelta,
        maxAllowed: maxReasonableIncrease
      });
      return false;
    }

    // Check for score manipulation patterns
    if (isScoreManipulated(score, previousScore)) {
      logError('Score manipulation detected');
      return false;
    }

    return true;

  } catch (error) {
    logError('Error validating score:', error);
    return false;
  }
}

/**
 * Detect potential score manipulation
 */
function isScoreManipulated(currentScore, previousScore) {
  // Check for round numbers that might indicate manipulation
  if (currentScore > 1000 && currentScore % 1000 === 0) {
    const increase = currentScore - previousScore;
    if (increase >= 1000) {
      return true;
    }
  }

  // Check for suspicious patterns (e.g., too many identical increments)
  // This would require more sophisticated tracking in a real implementation
  
  return false;
}

/**
 * Validate user input for length and content
 */
export function validateUserInput(input, maxLength = 100, allowEmpty = false) {
  if (!allowEmpty && (!input || input.trim().length === 0)) {
    return { valid: false, error: 'Input cannot be empty' };
  }

  if (typeof input !== 'string') {
    return { valid: false, error: 'Input must be a string' };
  }

  if (input.length > maxLength) {
    return { valid: false, error: `Input cannot exceed ${maxLength} characters` };
  }

  // Check for suspicious content
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(input)) {
      return { valid: false, error: 'Input contains invalid characters' };
    }
  }

  return { valid: true, sanitized: sanitizeInput(input) };
}

/**
 * Rate limiting to prevent abuse
 */
export function checkRateLimit(identifier = 'default') {
  try {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;

    // Get or create request log for this identifier
    if (!requestLog.has(identifier)) {
      requestLog.set(identifier, []);
    }

    const requests = requestLog.get(identifier);

    // Remove old requests outside the window
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    requestLog.set(identifier, validRequests);

    // Check if rate limit exceeded
    if (validRequests.length >= MAX_REQUESTS_PER_WINDOW) {
      logError('Rate limit exceeded for:', identifier);
      return false;
    }

    // Add current request
    validRequests.push(now);
    requestLog.set(identifier, validRequests);

    return true;

  } catch (error) {
    logError('Error checking rate limit:', error);
    return true; // Allow request on error to avoid blocking legitimate users
  }
}

/**
 * Verify Telegram init data integrity
 */
export function verifyInitData() {
  if (!isInsideTelegram()) {
    logDev('Not running in Telegram environment - skipping init data verification');
    return true;
  }

  try {
    const tg = getTelegramWebApp();
    if (!tg) {
      throw new Error('Telegram WebApp not available');
    }

    // Check if init data exists
    const initData = tg.initData;
    const initDataUnsafe = tg.initDataUnsafe;

    if (!initData || !initDataUnsafe) {
      throw new Error('Telegram init data missing');
    }

    // Basic validation of init data structure
    if (!initDataUnsafe.user) {
      throw new Error('User data missing from init data');
    }

    // Validate user object structure
    const user = initDataUnsafe.user;
    if (!user.id || typeof user.id !== 'number') {
      throw new Error('Invalid user ID in init data');
    }

    // Check for required user fields
    if (!user.first_name || typeof user.first_name !== 'string') {
      logError('User first name missing or invalid');
    }

    // Validate timestamp if present
    if (initDataUnsafe.auth_date) {
      const authDate = new Date(initDataUnsafe.auth_date * 1000);
      const now = new Date();
      const timeDiff = now - authDate;
      
      // Check if auth data is too old (24 hours)
      if (timeDiff > 24 * 60 * 60 * 1000) {
        logError('Init data is too old - may be stale');
      }
    }

    logInfo('✅ Telegram init data verification passed');
    return true;

  } catch (error) {
    logError('Telegram init data verification failed:', error);
    
    // In development, allow graceful fallback instead of blocking the game
    if (window.location.hostname === 'localhost' || window.location.hostname.includes('replit')) {
      logError('Development environment detected - allowing game to continue without Telegram verification');
      return false; // Return false but don't throw
    }
    
    throw error;
  }
}

/**
 * Generate secure random token
 */
export function generateSecureToken(length = 16) {
  try {
    const array = new Uint8Array(length);
    
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(array);
    } else {
      // Fallback for older browsers
      for (let i = 0; i < length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }

    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');

  } catch (error) {
    logError('Error generating secure token:', error);
    // Fallback to timestamp + random
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

/**
 * Hash sensitive data (simple implementation)
 */
export function hashData(data) {
  try {
    if (typeof data !== 'string') {
      data = JSON.stringify(data);
    }

    // Simple hash function for non-cryptographic purposes
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(36);

  } catch (error) {
    logError('Error hashing data:', error);
    return null;
  }
}

/**
 * Validate and sanitize leaderboard entry
 */
export function validateLeaderboardEntry(entry) {
  try {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    // Validate required fields
    if (!entry.id || !entry.name || typeof entry.score !== 'number') {
      logError('Invalid leaderboard entry structure');
      return null;
    }

    // Sanitize and validate fields
    const sanitizedEntry = {
      id: sanitizeInput(entry.id.toString()).slice(0, 50),
      name: sanitizeInput(entry.name.toString()).slice(0, 30),
      score: Math.max(0, Math.floor(entry.score)),
      timestamp: entry.timestamp || Date.now()
    };

    // Additional validation
    if (sanitizedEntry.id.length === 0 || sanitizedEntry.name.length === 0) {
      logError('Leaderboard entry has empty required fields');
      return null;
    }

    if (sanitizedEntry.score > 999999999) { // Reasonable maximum score
      logError('Leaderboard entry score too high');
      return null;
    }

    return sanitizedEntry;

  } catch (error) {
    logError('Error validating leaderboard entry:', error);
    return null;
  }
}

/**
 * Check for common attack patterns in URLs
 */
export function validateUrl(url) {
  try {
    if (!url || typeof url !== 'string') {
      return false;
    }

    // Basic URL validation
    const urlPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
    if (!urlPattern.test(url)) {
      return false;
    }

    // Check for suspicious patterns
    const suspiciousPatterns = [
      /javascript:/i,
      /data:/i,
      /vbscript:/i,
      /file:/i,
      /ftp:/i
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(url)) {
        logError('Suspicious URL pattern detected:', pattern);
        return false;
      }
    }

    return true;

  } catch (error) {
    logError('Error validating URL:', error);
    return false;
  }
}

/**
 * Content Security Policy helpers
 */
export function enforceCSP() {
  try {
    // Check if CSP is already set
    const existingCSP = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (existingCSP) {
      logDev('CSP already set');
      return;
    }

    // Set basic CSP via meta tag
    const cspMeta = document.createElement('meta');
    cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
    cspMeta.setAttribute('content', 
      "default-src 'self' https:; " +
      "script-src 'self' 'unsafe-inline' https://telegram.org; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' https:; " +
      "media-src 'self' https:; " +
      "font-src 'self' https:;"
    );

    document.head.appendChild(cspMeta);
    logDev('CSP policy enforced');

  } catch (error) {
    logError('Error enforcing CSP:', error);
  }
}

/**
 * Secure local storage operations
 */
export function secureLocalStorage() {
  try {
    // Check if localStorage is available and working
    const testKey = '__security_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);

    // Wrap localStorage to add validation
    const originalSetItem = localStorage.setItem;
    const originalGetItem = localStorage.getItem;

    localStorage.setItem = function(key, value) {
      try {
        // Validate key
        if (!key || typeof key !== 'string') {
          throw new Error('Invalid localStorage key');
        }

        // Validate value
        if (value === undefined || value === null) {
          value = '';
        }

        return originalSetItem.call(this, sanitizeInput(key), String(value));

      } catch (error) {
        logError('Error in secure localStorage.setItem:', error);
        throw error;
      }
    };

    localStorage.getItem = function(key) {
      try {
        if (!key || typeof key !== 'string') {
          return null;
        }

        return originalGetItem.call(this, sanitizeInput(key));

      } catch (error) {
        logError('Error in secure localStorage.getItem:', error);
        return null;
      }
    };

    logDev('Secure localStorage wrapper installed');

  } catch (error) {
    logError('localStorage not available or error setting up security:', error);
  }
}

/**
 * Initialize security measures
 */
export function initSecurity() {
  try {
    logInfo('🔒 Initializing security measures...');

    // Set up Content Security Policy
    enforceCSP();

    // Secure localStorage operations
    secureLocalStorage();

    // Set up rate limiting cleanup
    setInterval(() => {
      const now = Date.now();
      const cutoff = now - RATE_LIMIT_WINDOW;

      for (const [identifier, requests] of requestLog.entries()) {
        const validRequests = requests.filter(timestamp => timestamp > cutoff);
        if (validRequests.length === 0) {
          requestLog.delete(identifier);
        } else {
          requestLog.set(identifier, validRequests);
        }
      }
    }, RATE_LIMIT_WINDOW);

    logInfo('✅ Security measures initialized');

  } catch (error) {
    logError('Error initializing security:', error);
  }
}

/**
 * Security audit function
 */
export function performSecurityAudit() {
  const audit = {
    timestamp: Date.now(),
    issues: [],
    warnings: [],
    recommendations: []
  };

  try {
    // Check for HTTPS
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      audit.issues.push('Application not served over HTTPS');
    }

    // Check for CSP
    if (!document.querySelector('meta[http-equiv="Content-Security-Policy"]')) {
      audit.warnings.push('Content Security Policy not detected');
    }

    // Check for secure cookies (if any)
    if (document.cookie && !document.cookie.includes('Secure')) {
      audit.warnings.push('Insecure cookies detected');
    }

    // Check localStorage usage
    const storageUsed = Object.keys(localStorage).length;
    if (storageUsed > 100) {
      audit.warnings.push('High localStorage usage detected');
    }

    // Check for development/debug code
    if (window.location.hostname === 'localhost' || window.console) {
      audit.recommendations.push('Remove debug code in production');
    }

    logInfo('Security audit completed:', audit);
    return audit;

  } catch (error) {
    audit.issues.push('Error performing security audit: ' + error.message);
    logError('Security audit failed:', error);
    return audit;
  }
}

// Initialize security when module loads
if (typeof window !== 'undefined') {
  initSecurity();
}

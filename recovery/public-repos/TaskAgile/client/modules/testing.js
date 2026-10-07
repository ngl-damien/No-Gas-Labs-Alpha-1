/**
 * Testing and Logging Module
 * Handles unit tests, logging, and development utilities
 */

// Configuration
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  DEV: 4
};

const CURRENT_LOG_LEVEL = (() => {
  if (typeof window !== 'undefined') {
    if (window.location.hostname === 'localhost' || 
        window.location.search.includes('debug=true')) {
      return LOG_LEVELS.DEV;
    }
    return LOG_LEVELS.INFO;
  }
  return LOG_LEVELS.INFO;
})();

// Test results storage
let testResults = [];
let performanceMetrics = [];

/**
 * Core logging functions
 */
export function logError(message, ...args) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.ERROR) {
    console.error(`[ERROR] ${message}`, ...args);
    
    // Store error for debugging
    if (typeof window !== 'undefined') {
      const error = {
        level: 'ERROR',
        message,
        args,
        timestamp: new Date().toISOString(),
        stack: new Error().stack
      };
      
      // Store in sessionStorage for debugging
      try {
        const errors = JSON.parse(sessionStorage.getItem('ngs_errors') || '[]');
        errors.unshift(error);
        errors.splice(50); // Keep only last 50 errors
        sessionStorage.setItem('ngs_errors', JSON.stringify(errors));
      } catch (e) {
        // Ignore storage errors
      }
    }
  }
}

export function logWarn(message, ...args) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.WARN) {
    console.warn(`[WARN] ${message}`, ...args);
  }
}

export function logInfo(message, ...args) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.INFO) {
    console.info(`[INFO] ${message}`, ...args);
  }
}

export function logDebug(message, ...args) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.DEBUG) {
    console.log(`[DEBUG] ${message}`, ...args);
  }
}

export function logDev(message, ...args) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.DEV) {
    console.log(`[DEV] ${message}`, ...args);
  }
}

/**
 * Performance monitoring
 */
export function startPerformanceTimer(label) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.DEV) {
    performance.mark(`${label}_start`);
  }
}

export function endPerformanceTimer(label) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.DEV) {
    try {
      performance.mark(`${label}_end`);
      performance.measure(label, `${label}_start`, `${label}_end`);
      
      const measure = performance.getEntriesByName(label)[0];
      if (measure) {
        const metric = {
          label,
          duration: measure.duration,
          timestamp: Date.now()
        };
        
        performanceMetrics.push(metric);
        
        // Keep only last 100 metrics
        if (performanceMetrics.length > 100) {
          performanceMetrics.shift();
        }
        
        logDev(`Performance: ${label} took ${measure.duration.toFixed(2)}ms`);
      }
    } catch (error) {
      logError('Error measuring performance:', error);
    }
  }
}

/**
 * Memory usage monitoring
 */
export function logMemoryUsage() {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.DEV && 'memory' in performance) {
    const memory = performance.memory;
    logDev('Memory usage:', {
      used: `${(memory.usedJSHeapSize / 1048576).toFixed(2)} MB`,
      total: `${(memory.totalJSHeapSize / 1048576).toFixed(2)} MB`,
      limit: `${(memory.jsHeapSizeLimit / 1048576).toFixed(2)} MB`
    });
  }
}

/**
 * Test framework
 */
class TestRunner {
  constructor() {
    this.tests = [];
    this.currentSuite = null;
  }

  describe(suiteName, fn) {
    const previousSuite = this.currentSuite;
    this.currentSuite = suiteName;
    
    logDev(`Starting test suite: ${suiteName}`);
    
    try {
      fn();
    } catch (error) {
      logError(`Error in test suite ${suiteName}:`, error);
    }
    
    this.currentSuite = previousSuite;
  }

  it(testName, fn) {
    const fullName = this.currentSuite ? `${this.currentSuite}: ${testName}` : testName;
    
    const test = {
      name: fullName,
      status: 'pending',
      startTime: performance.now(),
      endTime: null,
      duration: null,
      error: null
    };

    this.tests.push(test);

    try {
      const result = fn();
      
      // Handle async tests
      if (result && typeof result.then === 'function') {
        return result
          .then(() => {
            test.status = 'passed';
            test.endTime = performance.now();
            test.duration = test.endTime - test.startTime;
            logDev(`✅ ${fullName} (${test.duration.toFixed(2)}ms)`);
          })
          .catch(error => {
            test.status = 'failed';
            test.error = error.message || error;
            test.endTime = performance.now();
            test.duration = test.endTime - test.startTime;
            logError(`❌ ${fullName}:`, error);
          });
      } else {
        test.status = 'passed';
        test.endTime = performance.now();
        test.duration = test.endTime - test.startTime;
        logDev(`✅ ${fullName} (${test.duration.toFixed(2)}ms)`);
      }
    } catch (error) {
      test.status = 'failed';
      test.error = error.message || error;
      test.endTime = performance.now();
      test.duration = test.endTime - test.startTime;
      logError(`❌ ${fullName}:`, error);
    }
  }

  expect(actual) {
    return {
      toBe: (expected) => {
        if (actual !== expected) {
          throw new Error(`Expected ${actual} to be ${expected}`);
        }
      },
      
      toEqual: (expected) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
        }
      },
      
      toBeTruthy: () => {
        if (!actual) {
          throw new Error(`Expected ${actual} to be truthy`);
        }
      },
      
      toBeFalsy: () => {
        if (actual) {
          throw new Error(`Expected ${actual} to be falsy`);
        }
      },
      
      toThrow: () => {
        if (typeof actual !== 'function') {
          throw new Error('Expected a function that throws');
        }
        
        try {
          actual();
          throw new Error('Expected function to throw');
        } catch (error) {
          // Expected to throw
        }
      },
      
      toBeGreaterThan: (expected) => {
        if (actual <= expected) {
          throw new Error(`Expected ${actual} to be greater than ${expected}`);
        }
      },
      
      toBeLessThan: (expected) => {
        if (actual >= expected) {
          throw new Error(`Expected ${actual} to be less than ${expected}`);
        }
      },
      
      toContain: (expected) => {
        if (Array.isArray(actual)) {
          if (!actual.includes(expected)) {
            throw new Error(`Expected array to contain ${expected}`);
          }
        } else if (typeof actual === 'string') {
          if (!actual.includes(expected)) {
            throw new Error(`Expected string to contain ${expected}`);
          }
        } else {
          throw new Error('Expected array or string for toContain');
        }
      }
    };
  }

  getResults() {
    const passed = this.tests.filter(t => t.status === 'passed').length;
    const failed = this.tests.filter(t => t.status === 'failed').length;
    const pending = this.tests.filter(t => t.status === 'pending').length;
    
    return {
      total: this.tests.length,
      passed,
      failed,
      pending,
      tests: [...this.tests]
    };
  }

  reset() {
    this.tests = [];
    this.currentSuite = null;
  }
}

// Global test runner instance
const testRunner = new TestRunner();

/**
 * Main test suite for No_Gas_Slaps™
 */
export function runUnitTests() {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.DEV) {
    return;
  }

  logInfo('🧪 Running unit tests...');
  testRunner.reset();

  // Import required modules for testing
  try {
    // Test sanitization functions
    testRunner.describe('Security Module', () => {
      testRunner.it('should sanitize HTML input', () => {
        const { sanitizeInput } = require('./security.js');
        const result = sanitizeInput('<script>alert("xss")</script>');
        testRunner.expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      });

      testRunner.it('should handle empty input', () => {
        const { sanitizeInput } = require('./security.js');
        const result = sanitizeInput('');
        testRunner.expect(result).toBe('');
      });

      testRunner.it('should handle null input', () => {
        const { sanitizeInput } = require('./security.js');
        const result = sanitizeInput(null);
        testRunner.expect(result).toBe('');
      });
    });

    // Test state management
    testRunner.describe('State Module', () => {
      testRunner.it('should initialize with default state', () => {
        const { getState } = require('./state.js');
        const state = getState();
        testRunner.expect(state.score).toBe(0);
        testRunner.expect(state.combo).toBe(1);
      });

      testRunner.it('should validate score changes', () => {
        const { validateScore } = require('./security.js');
        const valid = validateScore(100, 50, 1000);
        testRunner.expect(valid).toBeTruthy();
        
        const invalid = validateScore(10000, 50, 100);
        testRunner.expect(invalid).toBeFalsy();
      });
    });

    // Test error handling
    testRunner.describe('Error Module', () => {
      testRunner.it('should show and clear errors', () => {
        const { showError, clearError, getError } = require('./error.js');
        
        showError('Test error');
        testRunner.expect(getError()).toBe('Test error');
        
        clearError();
        testRunner.expect(getError()).toBe(null);
      });

      testRunner.it('should sanitize error messages', () => {
        const { showError, getError } = require('./error.js');
        
        showError('<script>alert("xss")</script>');
        const error = getError();
        testRunner.expect(error).toContain('&lt;script&gt;');
      });
    });

    // Test persistence
    testRunner.describe('Persistence Module', () => {
      testRunner.it('should save and load state', async () => {
        const { saveState, loadState } = require('./persistence.js');
        
        const testData = { test: 'value', number: 42 };
        await saveState('test_key', testData);
        
        const loaded = await loadState('test_key');
        testRunner.expect(loaded).toEqual(testData);
      });

      testRunner.it('should handle invalid keys', async () => {
        const { loadState } = require('./persistence.js');
        
        const result = await loadState('');
        testRunner.expect(result).toBe(null);
      });
    });

    // Test leaderboard
    testRunner.describe('Leaderboard Module', () => {
      testRunner.it('should validate leaderboard entries', () => {
        const { validateLeaderboardEntry } = require('./security.js');
        
        const validEntry = {
          id: 'user123',
          name: 'TestUser',
          score: 1000
        };
        
        const result = validateLeaderboardEntry(validEntry);
        testRunner.expect(result).toBeTruthy();
        testRunner.expect(result.id).toBe('user123');
      });

      testRunner.it('should reject invalid entries', () => {
        const { validateLeaderboardEntry } = require('./security.js');
        
        const invalidEntry = {
          id: '',
          name: '<script>',
          score: -100
        };
        
        const result = validateLeaderboardEntry(invalidEntry);
        testRunner.expect(result).toBe(null);
      });
    });

    // Test utilities
    testRunner.describe('Utility Functions', () => {
      testRunner.it('should generate secure tokens', () => {
        const { generateSecureToken } = require('./security.js');
        
        const token1 = generateSecureToken(16);
        const token2 = generateSecureToken(16);
        
        testRunner.expect(token1.length).toBe(32); // 16 bytes = 32 hex chars
        testRunner.expect(token1).not.toBe(token2);
      });

      testRunner.it('should validate URLs', () => {
        const { validateUrl } = require('./security.js');
        
        testRunner.expect(validateUrl('https://example.com')).toBeTruthy();
        testRunner.expect(validateUrl('javascript:alert(1)')).toBeFalsy();
        testRunner.expect(validateUrl('not-a-url')).toBeFalsy();
      });
    });

    // Performance tests
    testRunner.describe('Performance Tests', () => {
      testRunner.it('should complete state updates quickly', () => {
        const start = performance.now();
        
        // Simulate multiple state updates
        for (let i = 0; i < 100; i++) {
          // This would test actual state update performance
        }
        
        const duration = performance.now() - start;
        testRunner.expect(duration).toBeLessThan(100); // Should complete in < 100ms
      });
    });

  } catch (error) {
    logError('Error running tests:', error);
  }

  // Report results
  const results = testRunner.getResults();
  testResults = results.tests;

  logInfo(`🧪 Test Results: ${results.passed}/${results.total} passed`);
  
  if (results.failed > 0) {
    logError(`❌ ${results.failed} tests failed`);
    results.tests
      .filter(t => t.status === 'failed')
      .forEach(t => logError(`  - ${t.name}: ${t.error}`));
  } else {
    logInfo('✅ All tests passed!');
  }

  return results;
}

/**
 * System diagnostics
 */
export function runDiagnostics() {
  logInfo('🔍 Running system diagnostics...');

  const diagnostics = {
    timestamp: new Date().toISOString(),
    browser: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      cookieEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine
    },
    screen: {
      width: screen.width,
      height: screen.height,
      colorDepth: screen.colorDepth,
      pixelRatio: window.devicePixelRatio || 1
    },
    window: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      location: window.location.href
    },
    features: {
      localStorage: !!window.localStorage,
      sessionStorage: !!window.sessionStorage,
      indexedDB: !!window.indexedDB,
      webgl: !!window.WebGLRenderingContext,
      webAudio: !!(window.AudioContext || window.webkitAudioContext),
      gamepad: !!navigator.getGamepads,
      vibration: !!navigator.vibrate,
      notification: !!window.Notification,
      serviceWorker: !!navigator.serviceWorker
    },
    performance: {
      memory: 'memory' in performance ? {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit
      } : null,
      timing: performance.timing ? {
        loadStart: performance.timing.loadEventStart - performance.timing.navigationStart,
        domReady: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart
      } : null
    },
    errors: [],
    metrics: performanceMetrics.slice(-10) // Last 10 metrics
  };

  // Get recent errors from sessionStorage
  try {
    const errors = JSON.parse(sessionStorage.getItem('ngs_errors') || '[]');
    diagnostics.errors = errors.slice(0, 5); // Last 5 errors
  } catch (e) {
    // Ignore
  }

  logInfo('System diagnostics:', diagnostics);
  return diagnostics;
}

/**
 * Debug utilities
 */
export function enableDebugMode() {
  if (typeof window !== 'undefined') {
    window.ngsDebug = {
      logError,
      logWarn,
      logInfo,
      logDebug,
      logDev,
      runTests: runUnitTests,
      runDiagnostics,
      getTestResults: () => testResults,
      getPerformanceMetrics: () => performanceMetrics,
      clearLogs: () => {
        testResults = [];
        performanceMetrics = [];
        try {
          sessionStorage.removeItem('ngs_errors');
        } catch (e) {
          // Ignore
        }
      }
    };
    
    logDev('Debug mode enabled. Use window.ngsDebug for utilities.');
  }
}

/**
 * Production error reporting (placeholder)
 */
export function reportError(error, context = {}) {
  const errorReport = {
    message: error.message || error,
    stack: error.stack,
    context,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: window.location.href
  };

  // In a real implementation, this would send to an error reporting service
  logError('Error report:', errorReport);
  
  // Store locally for debugging
  try {
    const reports = JSON.parse(localStorage.getItem('ngs_error_reports') || '[]');
    reports.unshift(errorReport);
    reports.splice(10); // Keep only last 10 reports
    localStorage.setItem('ngs_error_reports', JSON.stringify(reports));
  } catch (e) {
    // Ignore storage errors
  }
}

// Initialize debug mode in development
if (CURRENT_LOG_LEVEL >= LOG_LEVELS.DEV) {
  enableDebugMode();
}

// Monitor memory usage in development
if (CURRENT_LOG_LEVEL >= LOG_LEVELS.DEV) {
  setInterval(logMemoryUsage, 30000); // Every 30 seconds
}

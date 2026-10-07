/**
 * Persistence Module
 * Handles data storage, sync queue, and offline capabilities
 */

import { logError, logInfo, logDev } from './testing.js';
import { sanitizeInput } from './security.js';

// Configuration
const STORAGE_PREFIX = 'ngs_';
const SYNC_QUEUE_KEY = 'ngs_sync_queue_v2';
const SYNC_RETRY_DELAY = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 5;
const STORAGE_QUOTA_WARNING = 0.8; // Warn at 80% storage usage

// State
let syncQueue = [];
let onlineStatus = navigator.onLine;
let syncInProgress = false;
let retryTimeout = null;

// Event listeners
const syncQueueListeners = [];

/**
 * Initialize persistence system
 */
export async function initPersistence() {
  try {
    // Load sync queue
    await loadSyncQueue();
    
    // Check storage quota
    await checkStorageQuota();
    
    // Set up online/offline handlers
    setupNetworkHandlers();
    
    // Process pending sync items
    if (onlineStatus && syncQueue.length > 0) {
      processSyncQueue();
    }
    
    logInfo('✅ Persistence system initialized');
    
  } catch (error) {
    logError('Error initializing persistence:', error);
    // Continue with limited functionality
  }
}

/**
 * Save data to localStorage with error handling
 */
export async function saveState(key, data) {
  try {
    if (!key || data === undefined) {
      throw new Error('Invalid parameters for saveState');
    }

    const prefixedKey = STORAGE_PREFIX + key;
    const serializedData = JSON.stringify({
      data: data,
      timestamp: Date.now(),
      version: '1.0'
    });

    // Check if storage would exceed quota
    const estimatedSize = new Blob([serializedData]).size;
    if (await wouldExceedQuota(estimatedSize)) {
      await cleanupOldData();
    }

    localStorage.setItem(prefixedKey, serializedData);
    logDev(`Data saved to localStorage: ${key}`);
    
  } catch (error) {
    if (error.name === 'QuotaExceededError') {
      logError('Storage quota exceeded');
      await handleStorageQuotaExceeded();
      throw new Error('Storage space full. Please clear some data.');
    } else {
      logError('Error saving data:', error);
      throw new Error('Failed to save data locally');
    }
  }
}

/**
 * Load data from localStorage with validation
 */
export async function loadState(key) {
  try {
    if (!key) {
      throw new Error('Invalid key for loadState');
    }

    const prefixedKey = STORAGE_PREFIX + key;
    const serializedData = localStorage.getItem(prefixedKey);
    
    if (!serializedData) {
      return null;
    }

    const parsedData = JSON.parse(serializedData);
    
    // Validate data structure
    if (!parsedData || typeof parsedData !== 'object') {
      logError('Invalid data structure for key:', key);
      return null;
    }

    // Check data age (optional - for cache invalidation)
    const age = Date.now() - (parsedData.timestamp || 0);
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    if (age > maxAge) {
      logDev(`Data expired for key: ${key}`);
      await removeState(key);
      return null;
    }

    logDev(`Data loaded from localStorage: ${key}`);
    return parsedData.data;
    
  } catch (error) {
    logError('Error loading data:', error);
    return null;
  }
}

/**
 * Remove data from localStorage
 */
export async function removeState(key) {
  try {
    if (!key) return;
    
    const prefixedKey = STORAGE_PREFIX + key;
    localStorage.removeItem(prefixedKey);
    logDev(`Data removed from localStorage: ${key}`);
    
  } catch (error) {
    logError('Error removing data:', error);
  }
}

/**
 * Clear all application data
 */
export async function clearAllData() {
  try {
    const keys = Object.keys(localStorage);
    const appKeys = keys.filter(key => key.startsWith(STORAGE_PREFIX));
    
    appKeys.forEach(key => {
      localStorage.removeItem(key);
    });
    
    syncQueue = [];
    await saveSyncQueue();
    
    logInfo('All application data cleared');
    
  } catch (error) {
    logError('Error clearing all data:', error);
    throw new Error('Failed to clear application data');
  }
}

/**
 * Add item to sync queue
 */
export function enqueueSync(item) {
  try {
    if (!item || typeof item !== 'object') {
      logError('Invalid sync item');
      return;
    }

    // Sanitize sync item
    const sanitizedItem = {
      id: generateSyncId(),
      type: sanitizeInput(item.type || 'unknown'),
      data: item.data, // Data should be validated by calling module
      timestamp: Date.now(),
      attempts: 0,
      maxAttempts: item.maxAttempts || MAX_RETRY_ATTEMPTS,
      priority: item.priority || 'normal',
      retries: item.retries || 0
    };

    // Add to queue
    syncQueue.push(sanitizedItem);
    
    // Sort by priority and timestamp
    syncQueue.sort((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 };
      const priorityDiff = (priorityOrder[b.priority] || 2) - (priorityOrder[a.priority] || 2);
      
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp - b.timestamp;
    });

    // Limit queue size
    if (syncQueue.length > 1000) {
      syncQueue = syncQueue.slice(0, 1000);
      logError('Sync queue size limit reached, dropping oldest items');
    }

    // Save queue
    saveSyncQueue();
    
    // Notify listeners
    notifySyncQueueListeners();
    
    // Process immediately if online
    if (onlineStatus && !syncInProgress) {
      setTimeout(processSyncQueue, 100);
    }

    logDev('Item added to sync queue:', sanitizedItem.type);
    
  } catch (error) {
    logError('Error enqueueing sync item:', error);
  }
}

/**
 * Remove item from sync queue
 */
export function dequeueSync(item) {
  try {
    if (!item || !item.id) return;

    const index = syncQueue.findIndex(queueItem => queueItem.id === item.id);
    if (index > -1) {
      syncQueue.splice(index, 1);
      saveSyncQueue();
      notifySyncQueueListeners();
      logDev('Item removed from sync queue:', item.id);
    }
    
  } catch (error) {
    logError('Error dequeuing sync item:', error);
  }
}

/**
 * Get current sync queue
 */
export function getSyncQueue() {
  return [...syncQueue];
}

/**
 * Process sync queue
 */
async function processSyncQueue() {
  if (syncInProgress || !onlineStatus || syncQueue.length === 0) {
    return;
  }

  try {
    syncInProgress = true;
    logInfo('🔄 Processing sync queue...');

    // Get items ready for sync
    const itemsToSync = syncQueue.filter(item => 
      item.attempts < item.maxAttempts &&
      Date.now() - item.timestamp > (item.attempts * SYNC_RETRY_DELAY)
    );

    if (itemsToSync.length === 0) {
      logDev('No items ready for sync');
      return;
    }

    // Notify listeners about sync start
    notifySyncQueueListeners();

    // Process items in batches
    const batchSize = 5;
    for (let i = 0; i < itemsToSync.length; i += batchSize) {
      const batch = itemsToSync.slice(i, i + batchSize);
      await processSyncBatch(batch);
    }

    logInfo('✅ Sync queue processing completed');

  } catch (error) {
    logError('Error processing sync queue:', error);
  } finally {
    syncInProgress = false;
    
    // Schedule next processing if items remain
    if (syncQueue.length > 0) {
      scheduleNextSync();
    }
  }
}

/**
 * Process a batch of sync items
 */
async function processSyncBatch(batch) {
  const results = await Promise.allSettled(
    batch.map(item => processSyncItem(item))
  );

  results.forEach((result, index) => {
    const item = batch[index];
    
    if (result.status === 'fulfilled' && result.value) {
      // Success - remove from queue
      dequeueSync(item);
    } else {
      // Failure - increment attempts
      item.attempts++;
      item.lastError = result.reason?.message || 'Unknown error';
      
      if (item.attempts >= item.maxAttempts) {
        logError(`Sync item failed permanently: ${item.type}`, item.lastError);
        dequeueSync(item); // Remove failed items
      } else {
        logDev(`Sync item failed (attempt ${item.attempts}/${item.maxAttempts}): ${item.type}`);
      }
    }
  });

  // Save updated queue
  await saveSyncQueue();
}

/**
 * Process individual sync item
 */
async function processSyncItem(item) {
  try {
    logDev('Processing sync item:', item.type, item.id);

    // This would be replaced with actual API calls
    // For now, simulate different outcomes based on item type
    
    switch (item.type) {
      case 'leaderboard_update':
        return await simulateLeaderboardSync(item.data);
      
      case 'achievement_unlock':
        return await simulateAchievementSync(item.data);
      
      case 'user_progress':
        return await simulateProgressSync(item.data);
      
      default:
        logError('Unknown sync item type:', item.type);
        return false;
    }
    
  } catch (error) {
    logError('Error processing sync item:', error);
    throw error;
  }
}

/**
 * Simulate sync operations (replace with actual API calls)
 */
async function simulateLeaderboardSync(data) {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
  
  // Simulate occasional failures
  if (Math.random() < 0.1) {
    throw new Error('Network timeout');
  }
  
  logDev('Leaderboard sync completed for:', data);
  return true;
}

async function simulateAchievementSync(data) {
  await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
  
  if (Math.random() < 0.05) {
    throw new Error('Server error');
  }
  
  logDev('Achievement sync completed for:', data);
  return true;
}

async function simulateProgressSync(data) {
  await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
  
  if (Math.random() < 0.02) {
    throw new Error('Authentication error');
  }
  
  logDev('Progress sync completed for:', data);
  return true;
}

/**
 * Load sync queue from storage
 */
async function loadSyncQueue() {
  try {
    const queueData = await loadState(SYNC_QUEUE_KEY);
    if (queueData && Array.isArray(queueData)) {
      syncQueue = queueData.filter(item => 
        item && typeof item === 'object' && item.id && item.type
      );
    }
    
    logDev('Sync queue loaded:', syncQueue.length, 'items');
    
  } catch (error) {
    logError('Error loading sync queue:', error);
    syncQueue = [];
  }
}

/**
 * Save sync queue to storage
 */
async function saveSyncQueue() {
  try {
    await saveState(SYNC_QUEUE_KEY, syncQueue);
  } catch (error) {
    logError('Error saving sync queue:', error);
  }
}

/**
 * Generate unique sync ID
 */
function generateSyncId() {
  return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Schedule next sync processing
 */
function scheduleNextSync() {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
  }

  retryTimeout = setTimeout(() => {
    if (onlineStatus) {
      processSyncQueue();
    }
  }, SYNC_RETRY_DELAY);
}

/**
 * Setup network event handlers
 */
function setupNetworkHandlers() {
  window.addEventListener('online', () => {
    onlineStatus = true;
    logInfo('🌐 Connection restored');
    
    // Process pending sync items
    if (syncQueue.length > 0) {
      setTimeout(processSyncQueue, 1000);
    }
  });

  window.addEventListener('offline', () => {
    onlineStatus = false;
    logInfo('📡 Connection lost - offline mode activated');
    
    // Cancel pending sync operations
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
  });
}

/**
 * Check storage quota and usage
 */
async function checkStorageQuota() {
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const usageRatio = estimate.usage / estimate.quota;
      
      if (usageRatio > STORAGE_QUOTA_WARNING) {
        logError(`Storage usage high: ${Math.round(usageRatio * 100)}%`);
        
        // Trigger cleanup if needed
        if (usageRatio > 0.95) {
          await cleanupOldData();
        }
      }
      
      logDev(`Storage usage: ${Math.round(usageRatio * 100)}% (${estimate.usage}/${estimate.quota} bytes)`);
    }
  } catch (error) {
    logError('Error checking storage quota:', error);
  }
}

/**
 * Check if operation would exceed storage quota
 */
async function wouldExceedQuota(additionalSize) {
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const newUsage = estimate.usage + additionalSize;
      return newUsage > estimate.quota * 0.95; // Leave 5% buffer
    }
  } catch (error) {
    logError('Error checking quota:', error);
  }
  
  return false;
}

/**
 * Cleanup old data to free storage space
 */
async function cleanupOldData() {
  try {
    logInfo('🧹 Cleaning up old data...');
    
    const keys = Object.keys(localStorage);
    const appKeys = keys.filter(key => key.startsWith(STORAGE_PREFIX));
    
    // Get data with timestamps
    const dataWithAge = [];
    
    for (const key of appKeys) {
      try {
        const data = JSON.parse(localStorage.getItem(key));
        if (data && data.timestamp) {
          dataWithAge.push({
            key,
            timestamp: data.timestamp,
            age: Date.now() - data.timestamp
          });
        }
      } catch (error) {
        // Invalid data - mark for deletion
        dataWithAge.push({
          key,
          timestamp: 0,
          age: Infinity
        });
      }
    }
    
    // Sort by age (oldest first)
    dataWithAge.sort((a, b) => b.age - a.age);
    
    // Remove oldest 20% of data
    const itemsToRemove = Math.ceil(dataWithAge.length * 0.2);
    for (let i = 0; i < itemsToRemove; i++) {
      localStorage.removeItem(dataWithAge[i].key);
    }
    
    logInfo(`Cleaned up ${itemsToRemove} old data items`);
    
  } catch (error) {
    logError('Error during cleanup:', error);
  }
}

/**
 * Handle storage quota exceeded
 */
async function handleStorageQuotaExceeded() {
  try {
    // Aggressive cleanup
    await cleanupOldData();
    
    // Clear sync queue of old items
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    syncQueue = syncQueue.filter(item => item.timestamp > cutoffTime);
    await saveSyncQueue();
    
    logInfo('Storage quota exceeded - performed emergency cleanup');
    
  } catch (error) {
    logError('Error handling storage quota exceeded:', error);
  }
}

/**
 * Get online status
 */
export function getOnlineStatus() {
  return onlineStatus;
}

/**
 * Event listener management
 */
export function onSyncQueueChange(callback) {
  if (typeof callback === 'function') {
    syncQueueListeners.push(callback);
  }
}

function notifySyncQueueListeners() {
  const queueCopy = getSyncQueue();
  syncQueueListeners.forEach(callback => {
    try {
      callback(queueCopy);
    } catch (error) {
      logError('Error in sync queue listener:', error);
    }
  });
}

/**
 * Cleanup function
 */
export function cleanup() {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  
  syncQueueListeners.length = 0;
  syncInProgress = false;
}

// Initialize persistence system when module loads
if (typeof window !== 'undefined') {
  // Auto-initialize after a short delay
  setTimeout(initPersistence, 50);
}

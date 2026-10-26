/**
 * Leaderboard API Module
 * Handles leaderboard data management, sync, and caching
 */

import { loadState, saveState, enqueueSync, getOnlineStatus } from './persistence.js';
import { getUser, isInsideTelegram } from './telegram-api.js';
import { sanitizeInput } from './security.js';
import { logError, logInfo, logDev } from './testing.js';

// Configuration
const LEADERBOARD_KEY = 'ngs_leaderboard_v2';
const CACHE_KEY = 'ngs_leaderboard_cache_v1';
const MAX_LEADERBOARD_SIZE = 100;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const SYNC_RETRY_DELAY = 30000; // 30 seconds

// State
let leaderboard = [];
let leaderboardCache = null;
let lastCacheTime = 0;
let syncInProgress = false;
let retryTimeout = null;

// Event listeners
const leaderboardListeners = [];

/**
 * Initialize leaderboard system
 */
export async function initLeaderboard() {
  try {
    // Load cached leaderboard
    leaderboardCache = await loadState(CACHE_KEY);
    if (leaderboardCache && Array.isArray(leaderboardCache.data)) {
      leaderboard = leaderboardCache.data;
      lastCacheTime = leaderboardCache.timestamp || 0;
    }

    // Load local leaderboard as fallback
    const localLeaderboard = await loadState(LEADERBOARD_KEY);
    if (localLeaderboard && Array.isArray(localLeaderboard)) {
      // Merge with cache, preferring cache if recent
      if (!leaderboard.length || Date.now() - lastCacheTime > CACHE_DURATION) {
        leaderboard = mergeLeaderboards(leaderboard, localLeaderboard);
      }
    }

    // Validate and sanitize leaderboard data
    leaderboard = validateLeaderboard(leaderboard);

    logInfo('✅ Leaderboard initialized with', leaderboard.length, 'entries');
    notifyListeners();

    // Start background sync if online
    if (getOnlineStatus()) {
      scheduleSync();
    }

  } catch (error) {
    logError('Error initializing leaderboard:', error);
    leaderboard = [];
  }
}

/**
 * Get current leaderboard
 */
export function getLeaderboard() {
  return [...leaderboard].slice(0, 50); // Return top 50 for display
}

/**
 * Update player score in leaderboard
 */
export function updateLeaderboard(score) {
  const user = getUser();
  if (!user || typeof score !== 'number' || score < 0) {
    logError('Invalid leaderboard update parameters');
    return;
  }

  try {
    // Sanitize user data
    const playerEntry = {
      id: sanitizeInput(user.id?.toString() || 'anonymous'),
      name: sanitizeInput(user.first_name || user.username || 'Anonymous'),
      score: Math.floor(score),
      timestamp: Date.now(),
      session: generateSessionId()
    };

    // Remove existing entry for this player
    leaderboard = leaderboard.filter(entry => entry.id !== playerEntry.id);

    // Add new entry
    leaderboard.push(playerEntry);

    // Sort by score (descending)
    leaderboard.sort((a, b) => b.score - a.score);

    // Limit size
    leaderboard = leaderboard.slice(0, MAX_LEADERBOARD_SIZE);

    // Save locally
    saveLocalLeaderboard();

    // Queue for remote sync
    if (isInsideTelegram()) {
      enqueueSync({
        type: 'leaderboard_update',
        data: playerEntry,
        priority: 'normal',
        retries: 3
      });
    }

    logDev('Leaderboard updated for player:', playerEntry.name, 'Score:', playerEntry.score);
    notifyListeners();

  } catch (error) {
    logError('Error updating leaderboard:', error);
  }
}

/**
 * Refresh leaderboard from server
 */
export async function refreshLeaderboard() {
  if (syncInProgress) {
    logDev('Leaderboard refresh already in progress');
    return;
  }

  try {
    syncInProgress = true;
    logInfo('🔄 Refreshing leaderboard...');

    // Simulate API call for now - replace with actual endpoint
    const refreshedData = await fetchLeaderboardFromServer();
    
    if (refreshedData && Array.isArray(refreshedData)) {
      // Validate server data
      const validatedData = validateLeaderboard(refreshedData);
      
      // Merge with local data
      leaderboard = mergeLeaderboards(validatedData, leaderboard);
      
      // Update cache
      await updateCache();
      
      // Save locally
      await saveLocalLeaderboard();
      
      logInfo('✅ Leaderboard refreshed successfully');
      notifyListeners();
    }

  } catch (error) {
    logError('Error refreshing leaderboard:', error);
    throw new Error('Failed to refresh leaderboard. Please try again.');
  } finally {
    syncInProgress = false;
  }
}

/**
 * Sync leaderboard with server
 */
export async function syncLeaderboard(syncQueue) {
  if (!Array.isArray(syncQueue) || syncQueue.length === 0) {
    return;
  }

  if (syncInProgress) {
    logDev('Sync already in progress, queuing for later');
    return;
  }

  try {
    syncInProgress = true;
    logInfo('🔄 Syncing leaderboard data...');

    // Process leaderboard sync items
    const leaderboardItems = syncQueue.filter(item => 
      item.type === 'leaderboard_update' && item.data
    );

    if (leaderboardItems.length === 0) {
      return;
    }

    // Group by player to send latest score only
    const latestScores = new Map();
    leaderboardItems.forEach(item => {
      const playerId = item.data.id;
      if (!latestScores.has(playerId) || 
          item.data.timestamp > latestScores.get(playerId).timestamp) {
        latestScores.set(playerId, item.data);
      }
    });

    // Send to server
    const syncResults = await Promise.allSettled(
      Array.from(latestScores.values()).map(scoreData => 
        submitScoreToServer(scoreData)
      )
    );

    // Process results
    let successCount = 0;
    let failCount = 0;

    syncResults.forEach((result, index) => {
      const item = leaderboardItems[index];
      if (result.status === 'fulfilled') {
        successCount++;
        // Remove from sync queue
        const event = new CustomEvent('syncItemCompleted', { 
          detail: { item } 
        });
        document.dispatchEvent(event);
      } else {
        failCount++;
        logError('Sync failed for item:', result.reason);
      }
    });

    logInfo(`✅ Leaderboard sync completed: ${successCount} success, ${failCount} failed`);

    // Refresh leaderboard after successful sync
    if (successCount > 0) {
      setTimeout(() => refreshLeaderboard(), 1000);
    }

  } catch (error) {
    logError('Error syncing leaderboard:', error);
    scheduleRetrySync();
  } finally {
    syncInProgress = false;
  }
}

/**
 * Get player rank
 */
export function getPlayerRank(playerId) {
  const index = leaderboard.findIndex(entry => entry.id === playerId);
  return index >= 0 ? index + 1 : null;
}

/**
 * Get player stats
 */
export function getPlayerStats(playerId) {
  const entry = leaderboard.find(entry => entry.id === playerId);
  if (!entry) return null;

  const rank = getPlayerRank(playerId);
  const totalPlayers = leaderboard.length;
  const percentile = totalPlayers > 0 ? ((totalPlayers - rank + 1) / totalPlayers) * 100 : 0;

  return {
    rank,
    score: entry.score,
    totalPlayers,
    percentile: Math.round(percentile)
  };
}

/**
 * Validate leaderboard data
 */
function validateLeaderboard(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .filter(entry => {
      return entry && 
             typeof entry.id === 'string' && 
             typeof entry.name === 'string' && 
             typeof entry.score === 'number' &&
             entry.score >= 0 &&
             entry.name.length > 0;
    })
    .map(entry => ({
      id: sanitizeInput(entry.id),
      name: sanitizeInput(entry.name).slice(0, 50), // Limit name length
      score: Math.floor(Math.max(0, entry.score)),
      timestamp: entry.timestamp || Date.now(),
      session: entry.session || generateSessionId()
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LEADERBOARD_SIZE);
}

/**
 * Merge two leaderboard arrays
 */
function mergeLeaderboards(primary, secondary) {
  const merged = new Map();

  // Add primary entries
  primary.forEach(entry => {
    merged.set(entry.id, entry);
  });

  // Add secondary entries if not present or if newer
  secondary.forEach(entry => {
    const existing = merged.get(entry.id);
    if (!existing || 
        entry.score > existing.score || 
        (entry.score === existing.score && entry.timestamp > existing.timestamp)) {
      merged.set(entry.id, entry);
    }
  });

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LEADERBOARD_SIZE);
}

/**
 * Save leaderboard locally
 */
async function saveLocalLeaderboard() {
  try {
    await saveState(LEADERBOARD_KEY, leaderboard);
  } catch (error) {
    logError('Error saving local leaderboard:', error);
  }
}

/**
 * Update leaderboard cache
 */
async function updateCache() {
  try {
    const cacheData = {
      data: leaderboard,
      timestamp: Date.now()
    };
    
    await saveState(CACHE_KEY, cacheData);
    lastCacheTime = cacheData.timestamp;
    
  } catch (error) {
    logError('Error updating leaderboard cache:', error);
  }
}

/**
 * Fetch leaderboard from server (placeholder)
 */
async function fetchLeaderboardFromServer() {
  // This would be replaced with actual API endpoint
  // For now, return empty array to indicate no server data
  logDev('Fetching leaderboard from server...');
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Return empty array - real implementation would call actual API
  return [];
}

/**
 * Submit score to server (placeholder)
 */
async function submitScoreToServer(scoreData) {
  // This would be replaced with actual API endpoint
  logDev('Submitting score to server:', scoreData);
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Simulate success - real implementation would handle actual submission
  return { success: true, scoreData };
}

/**
 * Generate session ID for tracking
 */
function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Schedule background sync
 */
function scheduleSync() {
  // Clear existing timeout
  if (retryTimeout) {
    clearTimeout(retryTimeout);
  }

  // Schedule next sync
  retryTimeout = setTimeout(() => {
    if (getOnlineStatus() && !syncInProgress) {
      refreshLeaderboard().catch(error => {
        logError('Scheduled sync failed:', error);
        scheduleRetrySync();
      });
    }
  }, CACHE_DURATION);
}

/**
 * Schedule retry sync after failure
 */
function scheduleRetrySync() {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
  }

  retryTimeout = setTimeout(() => {
    if (getOnlineStatus()) {
      scheduleSync();
    }
  }, SYNC_RETRY_DELAY);
}

/**
 * Event listener management
 */
export function onLeaderboardChange(callback) {
  leaderboardListeners.push(callback);
}

function notifyListeners() {
  leaderboardListeners.forEach(callback => {
    try {
      callback(getLeaderboard());
    } catch (error) {
      logError('Error in leaderboard listener:', error);
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
  
  leaderboardListeners.length = 0;
  syncInProgress = false;
}

// Listen for online/offline events
window.addEventListener('online', () => {
  logInfo('Connection restored - resuming leaderboard sync');
  scheduleSync();
});

window.addEventListener('offline', () => {
  logInfo('Connection lost - pausing leaderboard sync');
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
});

// Initialize on module load
if (typeof window !== 'undefined') {
  // Auto-initialize after a short delay
  setTimeout(initLeaderboard, 100);
}

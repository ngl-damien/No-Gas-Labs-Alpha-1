
/**
 * No_Gas_Slaps™ - Multiplayer Module
 * Handles real-time multiplayer connections and synchronization
 */

let ws = null;
let playerId = null;
let players = {};
let connectionAttempts = 0;
let maxReconnectAttempts = 5;
let reconnectDelay = 1000;

/**
 * Initialize multiplayer connection
 */
export function initMultiplayer() {
  return new Promise((resolve, reject) => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        connectionAttempts = 0;
        console.log('✅ Multiplayer connected');
        announceToScreenReader('Connected to multiplayer game');
        resolve(true);
      };
      
      ws.onmessage = handleMessage;
      ws.onclose = handleDisconnect;
      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        reject(error);
      };
      
      // Timeout fallback
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
      
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(event) {
  try {
    const data = JSON.parse(event.data);
    
    switch (data.type) {
      case 'init':
        playerId = data.id;
        players = data.players;
        updateMultiplayerUI();
        announceToScreenReader(`You are player ${playerId}. ${Object.keys(players).length} players in game.`);
        break;
        
      case 'playerJoined':
        players[data.player.id] = data.player;
        updateMultiplayerUI();
        announceToScreenReader(`Player ${data.player.id} joined the game`);
        break;
        
      case 'playerLeft':
        delete players[data.id];
        updateMultiplayerUI();
        announceToScreenReader(`Player ${data.id} left the game`);
        break;
        
      case 'playerMoved':
        if (players[data.id]) {
          players[data.id].x = data.x;
          players[data.id].y = data.y;
          updatePlayerPosition(data.id, data.x, data.y);
        }
        break;
        
      case 'playerHit':
        if (players[data.id]) {
          players[data.id].health = data.health;
          showHitEffect(data.id, data.attacker, data.damage);
          
          if (data.id === playerId) {
            announceToScreenReader(`You were hit by player ${data.attacker}! Health: ${data.health}`);
          }
        }
        break;
        
      case 'playerDied':
        if (players[data.id]) {
          players[data.id].alive = false;
          showDeathEffect(data.id);
          
          if (data.id === playerId) {
            announceToScreenReader('You were eliminated! Respawning in 5 seconds...');
            setTimeout(() => respawnPlayer(), 5000);
          } else {
            announceToScreenReader(`Player ${data.id} was eliminated by player ${data.killerId}`);
          }
        }
        break;
        
      case 'playerUpdate':
        if (players[data.id]) {
          players[data.id].gas = data.gas;
          players[data.id].score = data.score;
          players[data.id].combo = data.combo;
          updatePlayerStats(data.id);
        }
        break;
        
      case 'gasRecharge':
        Object.assign(players, data.players);
        updateAllPlayerStats();
        break;
        
      case 'gameReset':
        players = data.players;
        updateMultiplayerUI();
        announceToScreenReader('Game reset! All players respawned.');
        break;
    }
    
    // Dispatch custom event for other modules
    window.dispatchEvent(new CustomEvent('ngs:multiplayer:update', { 
      detail: { type: data.type, data, players, playerId } 
    }));
    
  } catch (error) {
    console.error('Error handling multiplayer message:', error);
  }
}

/**
 * Handle disconnection and reconnection
 */
function handleDisconnect() {
  console.log('🔌 Multiplayer disconnected');
  announceToScreenReader('Disconnected from multiplayer. Attempting to reconnect...');
  
  if (connectionAttempts < maxReconnectAttempts) {
    connectionAttempts++;
    setTimeout(() => {
      console.log(`🔄 Reconnection attempt ${connectionAttempts}/${maxReconnectAttempts}`);
      initMultiplayer().catch(() => {
        reconnectDelay *= 1.5; // Exponential backoff
      });
    }, reconnectDelay);
  } else {
    announceToScreenReader('Could not reconnect to multiplayer. Playing in offline mode.');
    showError('Lost connection to multiplayer game');
  }
}

/**
 * Send player movement
 */
export function sendMovement(x, y) {
  if (ws && ws.readyState === WebSocket.OPEN && playerId) {
    ws.send(JSON.stringify({ type: 'move', x, y }));
  }
}

/**
 * Send slap action
 */
export function sendSlap(targetId = null) {
  if (ws && ws.readyState === WebSocket.OPEN && playerId) {
    // Auto-target nearest player if no target specified
    if (!targetId) {
      targetId = findNearestPlayer();
    }
    
    ws.send(JSON.stringify({ type: 'slap', targetId }));
    return true;
  }
  return false;
}

/**
 * Find nearest player for auto-targeting
 */
function findNearestPlayer() {
  if (!players[playerId]) return null;
  
  const myPlayer = players[playerId];
  let nearestId = null;
  let nearestDistance = Infinity;
  
  for (const id in players) {
    if (id == playerId || !players[id].alive) continue;
    
    const dx = players[id].x - myPlayer.x;
    const dy = players[id].y - myPlayer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance < nearestDistance && distance < 80) {
      nearestDistance = distance;
      nearestId = id;
    }
  }
  
  return nearestId ? parseInt(nearestId) : null;
}

/**
 * Update player profile
 */
export function updateProfile(name) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'updateProfile', name }));
  }
}

/**
 * Get current multiplayer state
 */
export function getMultiplayerState() {
  return {
    connected: ws && ws.readyState === WebSocket.OPEN,
    playerId,
    players,
    playerCount: Object.keys(players).length,
    isMultiplayer: true
  };
}

/**
 * UI Update Functions
 */
function updateMultiplayerUI() {
  const gameArea = document.getElementById('game-area');
  if (!gameArea) return;
  
  // Remove existing player elements
  gameArea.querySelectorAll('.multiplayer-player').forEach(el => el.remove());
  
  // Add player elements
  for (const id in players) {
    if (id == playerId) continue; // Don't show own player
    
    const playerEl = createPlayerElement(players[id]);
    gameArea.appendChild(playerEl);
  }
  
  // Update player count display
  const playerCountEl = document.getElementById('player-count');
  if (playerCountEl) {
    playerCountEl.textContent = `${Object.keys(players).length} players online`;
  }
}

function createPlayerElement(player) {
  const playerEl = document.createElement('div');
  playerEl.className = 'multiplayer-player';
  playerEl.id = `player-${player.id}`;
  playerEl.style.cssText = `
    position: absolute;
    left: ${player.x}px;
    top: ${player.y}px;
    transform: translate(-50%, -50%);
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: ${player.alive ? '#00c1ff' : '#666'};
    border: 3px solid #fff;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    color: white;
    font-size: 12px;
    z-index: 100;
  `;
  
  playerEl.innerHTML = `
    <span>${player.id}</span>
    <div class="health-bar" style="
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 40px;
      height: 4px;
      background: #333;
      border-radius: 2px;
    ">
      <div style="
        width: ${player.health}%;
        height: 100%;
        background: ${player.health > 50 ? '#4caf50' : player.health > 25 ? '#ff9500' : '#ff3366'};
        border-radius: 2px;
        transition: width 0.3s ease;
      "></div>
    </div>
  `;
  
  return playerEl;
}

function updatePlayerPosition(id, x, y) {
  const playerEl = document.getElementById(`player-${id}`);
  if (playerEl) {
    playerEl.style.left = `${x}px`;
    playerEl.style.top = `${y}px`;
  }
}

function updatePlayerStats(id) {
  const playerEl = document.getElementById(`player-${id}`);
  if (playerEl && players[id]) {
    const healthBar = playerEl.querySelector('.health-bar > div');
    if (healthBar) {
      healthBar.style.width = `${players[id].health}%`;
    }
  }
}

function updateAllPlayerStats() {
  for (const id in players) {
    updatePlayerStats(id);
  }
}

function showHitEffect(playerId, attackerId, damage) {
  const playerEl = document.getElementById(`player-${playerId}`);
  if (playerEl) {
    playerEl.style.transform = 'translate(-50%, -50%) scale(1.2)';
    playerEl.style.background = '#ff3366';
    
    setTimeout(() => {
      playerEl.style.transform = 'translate(-50%, -50%) scale(1)';
      playerEl.style.background = players[playerId]?.alive ? '#00c1ff' : '#666';
    }, 200);
  }
  
  // Show damage number
  showFloatingText(playerEl, `-${damage}`, '#ff3366');
}

function showDeathEffect(playerId) {
  const playerEl = document.getElementById(`player-${playerId}`);
  if (playerEl) {
    playerEl.style.opacity = '0.5';
    playerEl.style.background = '#666';
    showFloatingText(playerEl, '💀', '#ff3366');
  }
}

function showFloatingText(element, text, color) {
  if (!element) return;
  
  const floatingEl = document.createElement('div');
  floatingEl.textContent = text;
  floatingEl.style.cssText = `
    position: absolute;
    top: -20px;
    left: 50%;
    transform: translateX(-50%);
    color: ${color};
    font-weight: bold;
    font-size: 14px;
    pointer-events: none;
    z-index: 1000;
    animation: floatUp 1s ease-out forwards;
  `;
  
  element.appendChild(floatingEl);
  
  setTimeout(() => {
    floatingEl.remove();
  }, 1000);
}

function respawnPlayer() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'respawn' }));
  }
}

// Helper functions
function announceToScreenReader(message) {
  const announcer = document.getElementById('sr-announcer');
  if (announcer) {
    announcer.textContent = message;
  }
}

function showError(message) {
  // Integrate with existing error system
  window.dispatchEvent(new CustomEvent('ngs:error', { detail: message }));
}

// CSS Animation for floating text
const style = document.createElement('style');
style.textContent = `
  @keyframes floatUp {
    0% {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    100% {
      opacity: 0;
      transform: translateX(-50%) translateY(-30px);
    }
  }
`;
document.head.appendChild(style);

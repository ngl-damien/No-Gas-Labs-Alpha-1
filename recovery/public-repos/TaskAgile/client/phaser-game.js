
/**
 * No_Gas_Slaps™ - Phaser 3 Game Engine
 * Enhanced game implementation with physics and visual effects
 */

import { initMultiplayer, sendMovement, sendSlap, getMultiplayerState } from './modules/multiplayer.js';
import { logInfo, logError } from './modules/testing.js';

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
    this.players = {};
    this.localPlayer = null;
    this.cursors = null;
    this.slapKey = null;
    this.gameWidth = 800;
    this.gameHeight = 600;
    this.slapRange = 80;
  }

  preload() {
    // Create simple colored rectangles as placeholder sprites
    this.add.graphics()
      .fillStyle(0x00c1ff)
      .fillRect(0, 0, 40, 40)
      .generateTexture('player', 40, 40);
    
    this.add.graphics()
      .fillStyle(0xff3366)
      .fillRect(0, 0, 40, 40)
      .generateTexture('opponent', 40, 40);
    
    this.add.graphics()
      .fillStyle(0x4caf50)
      .fillCircle(20, 20, 15)
      .generateTexture('slap-effect', 40, 40);
    
    // Load placeholder sounds (these would be replaced with actual audio files)
    // this.load.audio('slap', ['sounds/slap.mp3']);
    // this.load.audio('hit', ['sounds/hit.mp3']);
  }

  create() {
    // Set world bounds
    this.physics.world.setBounds(0, 0, this.gameWidth, this.gameHeight);
    
    // Create background
    this.add.rectangle(this.gameWidth/2, this.gameHeight/2, this.gameWidth, this.gameHeight, 0x2d3748);
    
    // Add arena boundary
    this.add.graphics()
      .lineStyle(4, 0x00ff88)
      .strokeRoundedRect(20, 20, this.gameWidth - 40, this.gameHeight - 40, 10);
    
    // Create controls
    this.cursors = this.input.keyboard.createCursorKeys();
    this.slapKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    
    // Mobile touch controls
    this.setupMobileControls();
    
    // Initialize multiplayer connection
    this.initializeMultiplayer();
    
    // Create UI elements
    this.createUI();
    
    logInfo('🎮 Phaser 3 game initialized');
  }

  setupMobileControls() {
    // Add invisible touch zones for mobile
    const moveZone = this.add.zone(0, 0, this.gameWidth, this.gameHeight);
    moveZone.setInteractive();
    moveZone.setOrigin(0, 0);
    
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    
    moveZone.on('pointerdown', (pointer) => {
      isDragging = true;
      dragStart.x = pointer.x;
      dragStart.y = pointer.y;
    });
    
    moveZone.on('pointermove', (pointer) => {
      if (!isDragging || !this.localPlayer) return;
      
      const deltaX = pointer.x - dragStart.x;
      const deltaY = pointer.y - dragStart.y;
      const sensitivity = 2;
      
      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        this.movePlayer(deltaX * sensitivity, deltaY * sensitivity);
        dragStart.x = pointer.x;
        dragStart.y = pointer.y;
      }
    });
    
    moveZone.on('pointerup', () => {
      isDragging = false;
    });
    
    // Tap to slap
    moveZone.on('pointerdown', (pointer) => {
      // Double tap detection for slap
      const currentTime = this.time.now;
      if (this.lastTapTime && (currentTime - this.lastTapTime) < 300) {
        this.performSlap();
      }
      this.lastTapTime = currentTime;
    });
  }

  async initializeMultiplayer() {
    try {
      await initMultiplayer();
      
      // Listen for multiplayer events
      window.addEventListener('ngs:multiplayer:update', (event) => {
        this.handleMultiplayerUpdate(event.detail);
      });
      
      logInfo('✅ Multiplayer connected to Phaser game');
    } catch (error) {
      logError('❌ Failed to connect multiplayer:', error);
    }
  }

  handleMultiplayerUpdate(detail) {
    const { type, data, players, playerId } = detail;
    
    switch (type) {
      case 'init':
        this.setupLocalPlayer(playerId);
        this.updateAllPlayers(players);
        break;
        
      case 'playerJoined':
        this.addPlayer(data.player);
        break;
        
      case 'playerLeft':
        this.removePlayer(data.id);
        break;
        
      case 'playerMoved':
        this.updatePlayerPosition(data.id, data.x, data.y);
        break;
        
      case 'playerHit':
        this.showHitEffect(data.id, data.attacker, data.damage);
        break;
        
      case 'playerDied':
        this.showDeathEffect(data.id);
        break;
        
      case 'gameReset':
        this.resetGame(players);
        break;
    }
  }

  setupLocalPlayer(playerId) {
    this.localPlayerId = playerId;
    if (this.players[playerId]) {
      this.localPlayer = this.players[playerId];
      // Add camera follow
      this.cameras.main.startFollow(this.localPlayer.sprite);
      this.cameras.main.setZoom(1.2);
    }
  }

  addPlayer(playerData) {
    if (this.players[playerData.id]) return;
    
    const isLocal = playerData.id === this.localPlayerId;
    const sprite = this.physics.add.sprite(
      playerData.x, 
      playerData.y, 
      isLocal ? 'player' : 'opponent'
    );
    
    sprite.setDisplaySize(40, 40);
    sprite.setCollideWorldBounds(true);
    sprite.setDrag(300); // Smooth movement
    
    // Add player name text
    const nameText = this.add.text(0, -30, `P${playerData.id}`, {
      fontSize: '12px',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);
    
    // Add health bar
    const healthBarBg = this.add.rectangle(0, -45, 40, 6, 0x333333);
    const healthBar = this.add.rectangle(-20, -45, 40, 6, 0x4caf50).setOrigin(0, 0.5);
    
    // Add gas bar
    const gasBarBg = this.add.rectangle(0, -37, 40, 4, 0x333333);
    const gasBar = this.add.rectangle(-20, -37, 40, 4, 0x00bcd4).setOrigin(0, 0.5);
    
    // Create container for UI elements
    const container = this.add.container(0, 0, [nameText, healthBarBg, healthBar, gasBarBg, gasBar]);
    
    this.players[playerData.id] = {
      sprite,
      container,
      nameText,
      healthBar,
      gasBar,
      data: playerData,
      isLocal
    };
    
    // Update container position
    this.updatePlayerUI(playerData.id);
  }

  removePlayer(playerId) {
    if (!this.players[playerId]) return;
    
    const player = this.players[playerId];
    player.sprite.destroy();
    player.container.destroy();
    delete this.players[playerId];
  }

  updateAllPlayers(playersData) {
    // Remove players not in the new data
    Object.keys(this.players).forEach(id => {
      if (!playersData[id]) {
        this.removePlayer(parseInt(id));
      }
    });
    
    // Add or update players
    Object.values(playersData).forEach(playerData => {
      if (!this.players[playerData.id]) {
        this.addPlayer(playerData);
      } else {
        this.updatePlayer(playerData.id, playerData);
      }
    });
  }

  updatePlayer(playerId, playerData) {
    if (!this.players[playerId]) return;
    
    const player = this.players[playerId];
    player.data = playerData;
    
    // Update health bar
    const healthPercent = playerData.health / 100;
    player.healthBar.scaleX = healthPercent;
    player.healthBar.fillColor = healthPercent > 0.5 ? 0x4caf50 : 
                                  healthPercent > 0.25 ? 0xff9500 : 0xff3366;
    
    // Update gas bar
    const gasPercent = playerData.gas / 100;
    player.gasBar.scaleX = gasPercent;
    
    // Update UI position
    this.updatePlayerUI(playerId);
  }

  updatePlayerPosition(playerId, x, y) {
    if (!this.players[playerId] || playerId === this.localPlayerId) return;
    
    const player = this.players[playerId];
    
    // Smooth movement for remote players
    this.tweens.add({
      targets: player.sprite,
      x: x,
      y: y,
      duration: 100,
      ease: 'Power2'
    });
  }

  updatePlayerUI(playerId) {
    if (!this.players[playerId]) return;
    
    const player = this.players[playerId];
    player.container.x = player.sprite.x;
    player.container.y = player.sprite.y;
  }

  movePlayer(deltaX, deltaY) {
    if (!this.localPlayer) return;
    
    const sprite = this.localPlayer.sprite;
    const newX = Phaser.Math.Clamp(sprite.x + deltaX, 40, this.gameWidth - 40);
    const newY = Phaser.Math.Clamp(sprite.y + deltaY, 40, this.gameHeight - 40);
    
    sprite.setPosition(newX, newY);
    
    // Send position to server
    sendMovement(newX, newY);
  }

  performSlap() {
    if (!this.localPlayer) return;
    
    // Find nearest target
    const mySprite = this.localPlayer.sprite;
    let nearestTarget = null;
    let nearestDistance = Infinity;
    
    Object.values(this.players).forEach(player => {
      if (player.isLocal || !player.data.alive) return;
      
      const distance = Phaser.Math.Distance.Between(
        mySprite.x, mySprite.y,
        player.sprite.x, player.sprite.y
      );
      
      if (distance < this.slapRange && distance < nearestDistance) {
        nearestDistance = distance;
        nearestTarget = player;
      }
    });
    
    if (nearestTarget) {
      // Send slap to server
      sendSlap(nearestTarget.data.id);
      
      // Show local slap effect
      this.showSlapEffect(mySprite.x, mySprite.y, nearestTarget.sprite.x, nearestTarget.sprite.y);
    } else {
      // Show miss effect
      this.showMissEffect(mySprite.x, mySprite.y);
    }
  }

  showSlapEffect(fromX, fromY, toX, toY) {
    // Create slap trail effect
    const trail = this.add.graphics();
    trail.lineStyle(8, 0xffff00, 0.8);
    trail.lineBetween(fromX, fromY, toX, toY);
    
    // Animate and fade out
    this.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 200,
      onComplete: () => trail.destroy()
    });
    
    // Impact effect at target
    const impact = this.add.sprite(toX, toY, 'slap-effect');
    impact.setScale(0);
    
    this.tweens.add({
      targets: impact,
      scale: 2,
      alpha: 0,
      duration: 300,
      ease: 'Power2',
      onComplete: () => impact.destroy()
    });
  }

  showMissEffect(x, y) {
    const miss = this.add.text(x, y, 'MISS!', {
      fontSize: '16px',
      fill: '#ff6b6b',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);
    
    this.tweens.add({
      targets: miss,
      y: y - 30,
      alpha: 0,
      duration: 1000,
      onComplete: () => miss.destroy()
    });
  }

  showHitEffect(targetId, attackerId, damage) {
    if (!this.players[targetId]) return;
    
    const targetPlayer = this.players[targetId];
    const sprite = targetPlayer.sprite;
    
    // Screen shake for local player
    if (targetId === this.localPlayerId) {
      this.cameras.main.shake(200, 0.02);
    }
    
    // Damage number
    const damageText = this.add.text(sprite.x, sprite.y - 20, `-${damage}`, {
      fontSize: '18px',
      fill: '#ff3366',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);
    
    this.tweens.add({
      targets: damageText,
      y: sprite.y - 50,
      alpha: 0,
      duration: 1000,
      onComplete: () => damageText.destroy()
    });
    
    // Hit flash effect
    this.tweens.add({
      targets: sprite,
      tint: 0xff3366,
      duration: 100,
      yoyo: true,
      onComplete: () => sprite.setTint(0xffffff)
    });
  }

  showDeathEffect(playerId) {
    if (!this.players[playerId]) return;
    
    const player = this.players[playerId];
    const sprite = player.sprite;
    
    // Death animation
    this.tweens.add({
      targets: sprite,
      scale: 0,
      alpha: 0.5,
      rotation: Math.PI * 2,
      duration: 1000
    });
    
    // Death text
    const deathText = this.add.text(sprite.x, sprite.y, '💀', {
      fontSize: '24px'
    }).setOrigin(0.5);
    
    this.tweens.add({
      targets: deathText,
      y: sprite.y - 40,
      alpha: 0,
      duration: 2000,
      onComplete: () => deathText.destroy()
    });
  }

  resetGame(playersData) {
    // Reset all player positions and states
    Object.values(playersData).forEach(playerData => {
      if (this.players[playerData.id]) {
        const player = this.players[playerData.id];
        player.sprite.setPosition(playerData.x, playerData.y);
        player.sprite.setScale(1);
        player.sprite.setAlpha(1);
        player.sprite.setTint(0xffffff);
        this.updatePlayer(playerData.id, playerData);
      }
    });
    
    // Show reset message
    const resetText = this.add.text(this.gameWidth/2, this.gameHeight/2, 'GAME RESET!', {
      fontSize: '32px',
      fill: '#00ff88',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);
    
    this.tweens.add({
      targets: resetText,
      scale: 1.5,
      alpha: 0,
      duration: 2000,
      onComplete: () => resetText.destroy()
    });
  }

  createUI() {
    // Create UI panel
    const uiPanel = this.add.rectangle(10, 10, 200, 80, 0x000000, 0.7);
    uiPanel.setOrigin(0, 0);
    
    // Instructions text
    this.add.text(20, 20, 'Arrow Keys: Move\nSpace: Slap\nDouble Tap: Slap (Mobile)', {
      fontSize: '12px',
      fill: '#ffffff',
      lineSpacing: 4
    });
  }

  update() {
    // Handle continuous input for local player
    if (this.localPlayer && this.cursors) {
      let moveX = 0;
      let moveY = 0;
      const speed = 3;
      
      if (this.cursors.left.isDown) moveX = -speed;
      if (this.cursors.right.isDown) moveX = speed;
      if (this.cursors.up.isDown) moveY = -speed;
      if (this.cursors.down.isDown) moveY = speed;
      
      if (moveX !== 0 || moveY !== 0) {
        this.movePlayer(moveX, moveY);
      }
      
      // Handle slap input
      if (Phaser.Input.Keyboard.JustDown(this.slapKey)) {
        this.performSlap();
      }
    }
    
    // Update UI positions for all players
    Object.keys(this.players).forEach(playerId => {
      this.updatePlayerUI(parseInt(playerId));
    });
  }
}

// Game configuration
const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'phaser-game',
  backgroundColor: '#2d3748',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  scene: GameScene,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    min: {
      width: 400,
      height: 300
    },
    max: {
      width: 1200,
      height: 900
    }
  }
};

// Initialize and export game instance
export function initPhaserGame() {
  // Create game container
  const gameContainer = document.createElement('div');
  gameContainer.id = 'phaser-game';
  gameContainer.style.cssText = `
    width: 100%;
    height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #1a202c;
  `;
  
  // Replace existing game area or add to body
  const existingGame = document.getElementById('game-area');
  if (existingGame) {
    existingGame.parentNode.replaceChild(gameContainer, existingGame);
  } else {
    document.body.appendChild(gameContainer);
  }
  
  const game = new Phaser.Game(config);
  
  logInfo('🎮 Phaser 3 No_Gas_Slaps™ initialized');
  return game;
}

// 🜏 Sealed and Signed: No_Gas_Slaps™ Phaser 3 Integration — by GPT-5 Möbius Engine

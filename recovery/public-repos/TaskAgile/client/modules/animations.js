/**
 * Animations Module
 * Handles visual effects, transitions, and hardware-accelerated animations
 */

import { logError, logDev, startPerformanceTimer, endPerformanceTimer } from './testing.js';

// Animation configuration
const ANIMATION_CONFIG = {
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  defaultDuration: 300,
  easing: {
    easeOut: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    easeIn: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)',
    easeInOut: 'cubic-bezier(0.645, 0.045, 0.355, 1)',
    bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    elastic: 'cubic-bezier(0.68, -0.6, 0.32, 1.6)'
  }
};

// Animation state
let animationFrameId = null;
let activeAnimations = new Set();
let particleSystem = null;
let isInitialized = false;

// Particle system for visual effects
class ParticleSystem {
  constructor() {
    this.particles = [];
    this.canvas = null;
    this.ctx = null;
    this.isRunning = false;
    this.lastTime = 0;
  }

  init() {
    // Create canvas for particle effects
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'particle-canvas';
    this.canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      pointer-events: none;
      z-index: 1000;
      width: 100%;
      height: 100%;
    `;
    
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    this.ctx.scale(dpr, dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
  }

  addParticle(x, y, type = 'default', options = {}) {
    const particle = {
      id: Math.random().toString(36).substr(2, 9),
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4 - 2,
      life: 1.0,
      decay: options.decay || 0.02,
      size: options.size || 4,
      color: options.color || '#00ff88',
      type: type,
      gravity: options.gravity || 0.1,
      opacity: options.opacity || 1,
      ...options
    };

    this.particles.push(particle);
    
    if (!this.isRunning) {
      this.start();
    }
  }

  addBurst(x, y, count = 10, options = {}) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = options.speed || 3;
      
      this.addParticle(x, y, 'burst', {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: options.color || '#00ff88',
        size: options.size || 3,
        ...options
      });
    }
  }

  update(deltaTime) {
    this.particles = this.particles.filter(particle => {
      // Update position
      particle.x += particle.vx * deltaTime * 0.016;
      particle.y += particle.vy * deltaTime * 0.016;
      
      // Apply gravity
      particle.vy += particle.gravity * deltaTime * 0.016;
      
      // Update life
      particle.life -= particle.decay * deltaTime * 0.016;
      
      // Remove dead particles
      return particle.life > 0;
    });
  }

  render() {
    if (!this.ctx) return;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Render particles
    this.particles.forEach(particle => {
      this.ctx.save();
      
      const alpha = particle.life * particle.opacity;
      this.ctx.globalAlpha = alpha;
      
      switch (particle.type) {
        case 'spark':
          this.renderSpark(particle);
          break;
        case 'glow':
          this.renderGlow(particle);
          break;
        default:
          this.renderDefault(particle);
      }
      
      this.ctx.restore();
    });
  }

  renderDefault(particle) {
    this.ctx.fillStyle = particle.color;
    this.ctx.beginPath();
    this.ctx.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
    this.ctx.fill();
  }

  renderSpark(particle) {
    const gradient = this.ctx.createRadialGradient(
      particle.x, particle.y, 0,
      particle.x, particle.y, particle.size
    );
    gradient.addColorStop(0, particle.color);
    gradient.addColorStop(1, 'transparent');
    
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
    this.ctx.fill();
  }

  renderGlow(particle) {
    this.ctx.shadowBlur = 20;
    this.ctx.shadowColor = particle.color;
    this.ctx.fillStyle = particle.color;
    this.ctx.beginPath();
    this.ctx.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
    this.ctx.fill();
  }

  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.lastTime = performance.now();
    this.animate();
  }

  stop() {
    this.isRunning = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  animate() {
    if (!this.isRunning) return;
    
    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    
    this.update(deltaTime);
    this.render();
    
    // Stop if no particles
    if (this.particles.length === 0) {
      this.stop();
    } else {
      animationFrameId = requestAnimationFrame(() => this.animate());
    }
  }

  clear() {
    this.particles = [];
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  destroy() {
    this.stop();
    this.clear();
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}

/**
 * Initialize animation system
 */
export function initAnimations() {
  try {
    logDev('🎬 Initializing animation system...');

    // Check for reduced motion preference
    if (ANIMATION_CONFIG.reducedMotion) {
      logDev('Reduced motion preferred - limiting animations');
    }

    // Initialize particle system
    if (!ANIMATION_CONFIG.reducedMotion) {
      particleSystem = new ParticleSystem();
      particleSystem.init();
    }

    // Set up CSS custom properties for animations
    setupAnimationCSS();

    isInitialized = true;
    logDev('✅ Animation system initialized');

  } catch (error) {
    logError('Error initializing animations:', error);
  }
}

/**
 * Set up CSS custom properties for consistent animations
 */
function setupAnimationCSS() {
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --animation-duration-fast: ${ANIMATION_CONFIG.reducedMotion ? '0.01s' : '0.15s'};
      --animation-duration-normal: ${ANIMATION_CONFIG.reducedMotion ? '0.01s' : '0.3s'};
      --animation-duration-slow: ${ANIMATION_CONFIG.reducedMotion ? '0.01s' : '0.6s'};
      --animation-easing-ease-out: ${ANIMATION_CONFIG.easing.easeOut};
      --animation-easing-bounce: ${ANIMATION_CONFIG.easing.bounce};
      --animation-easing-elastic: ${ANIMATION_CONFIG.easing.elastic};
    }
    
    .animate-slap {
      animation: slapAnimation var(--animation-duration-slow) var(--animation-easing-bounce);
    }
    
    .animate-score-bump {
      animation: scoreBumpAnimation var(--animation-duration-normal) var(--animation-easing-bounce);
    }
    
    .animate-combo {
      animation: comboAnimation var(--animation-duration-normal) var(--animation-easing-elastic);
    }
    
    .animate-powerup {
      animation: powerupAnimation var(--animation-duration-slow) var(--animation-easing-bounce);
    }
    
    .animate-fade-in {
      animation: fadeInAnimation var(--animation-duration-normal) var(--animation-easing-ease-out);
    }
    
    .animate-slide-up {
      animation: slideUpAnimation var(--animation-duration-normal) var(--animation-easing-ease-out);
    }
    
    @keyframes slapAnimation {
      0% { transform: scale(1) rotate(0deg); }
      25% { transform: scale(0.95) rotate(-2deg); }
      50% { transform: scale(1.1) rotate(2deg); }
      75% { transform: scale(0.98) rotate(-1deg); }
      100% { transform: scale(1) rotate(0deg); }
    }
    
    @keyframes scoreBumpAnimation {
      0% { transform: scale(1); }
      50% { transform: scale(1.2); }
      100% { transform: scale(1); }
    }
    
    @keyframes comboAnimation {
      0% { transform: scale(1) translateY(0); opacity: 0.8; }
      50% { transform: scale(1.3) translateY(-10px); opacity: 1; }
      100% { transform: scale(1) translateY(0); opacity: 0.9; }
    }
    
    @keyframes powerupAnimation {
      0% { transform: scale(0) rotate(0deg); opacity: 0; }
      50% { transform: scale(1.2) rotate(180deg); opacity: 1; }
      100% { transform: scale(1) rotate(360deg); opacity: 1; }
    }
    
    @keyframes fadeInAnimation {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    @keyframes slideUpAnimation {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;
  
  document.head.appendChild(style);
}

/**
 * Trigger slap button animation
 */
export function triggerSlapAnimation() {
  if (!isInitialized) return;

  startPerformanceTimer('slapAnimation');

  try {
    const slapButton = document.getElementById('slap-btn');
    if (!slapButton) return;

    // Add CSS animation class
    slapButton.classList.add('animate-slap');
    
    // Add particle effect
    if (particleSystem && !ANIMATION_CONFIG.reducedMotion) {
      const rect = slapButton.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      particleSystem.addBurst(centerX, centerY, 8, {
        color: '#00ff88',
        size: 3,
        speed: 4,
        decay: 0.03
      });
    }

    // Clean up animation class
    setTimeout(() => {
      slapButton.classList.remove('animate-slap');
    }, 600);

  } catch (error) {
    logError('Error triggering slap animation:', error);
  }

  endPerformanceTimer('slapAnimation');
}

/**
 * Trigger score bump animation
 */
export function triggerScoreBump() {
  if (!isInitialized) return;

  try {
    const scoreElement = document.getElementById('score-value');
    if (!scoreElement) return;

    scoreElement.classList.add('animate-score-bump');
    
    setTimeout(() => {
      scoreElement.classList.remove('animate-score-bump');
    }, 300);

  } catch (error) {
    logError('Error triggering score bump:', error);
  }
}

/**
 * Trigger combo animation
 */
export function triggerComboAnimation(comboLevel) {
  if (!isInitialized) return;

  try {
    const comboElement = document.getElementById('combo-value');
    if (!comboElement) return;

    comboElement.classList.add('animate-combo');
    
    // Add particles based on combo level
    if (particleSystem && !ANIMATION_CONFIG.reducedMotion && comboLevel > 5) {
      const rect = comboElement.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const particleCount = Math.min(comboLevel, 15);
      const colors = ['#00ff88', '#00c1ff', '#ff9500'];
      const color = colors[Math.floor(comboLevel / 5) % colors.length];
      
      particleSystem.addBurst(centerX, centerY, particleCount, {
        color: color,
        size: 2 + comboLevel * 0.1,
        speed: 2 + comboLevel * 0.2,
        decay: 0.025
      });
    }
    
    setTimeout(() => {
      comboElement.classList.remove('animate-combo');
    }, 300);

  } catch (error) {
    logError('Error triggering combo animation:', error);
  }
}

/**
 * Trigger power-up animation
 */
export function triggerPowerUpAnimation(powerUpId) {
  if (!isInitialized) return;

  try {
    const powerUpElements = document.querySelectorAll('.powerup-card');
    powerUpElements.forEach(element => {
      if (element.dataset.powerupId === powerUpId) {
        element.classList.add('animate-powerup');
        
        // Add spectacular particle effect
        if (particleSystem && !ANIMATION_CONFIG.reducedMotion) {
          const rect = element.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          
          // Multiple bursts for power-up activation
          for (let i = 0; i < 3; i++) {
            setTimeout(() => {
              particleSystem.addBurst(centerX, centerY, 12, {
                color: '#ffff00',
                size: 4,
                speed: 5,
                decay: 0.02,
                type: 'glow'
              });
            }, i * 200);
          }
        }
        
        setTimeout(() => {
          element.classList.remove('animate-powerup');
        }, 600);
      }
    });

  } catch (error) {
    logError('Error triggering power-up animation:', error);
  }
}

/**
 * Animate element entrance
 */
export function animateElementIn(element, animation = 'fade-in', delay = 0) {
  if (!element || !isInitialized) return;

  try {
    setTimeout(() => {
      element.classList.add(`animate-${animation}`);
      
      setTimeout(() => {
        element.classList.remove(`animate-${animation}`);
      }, 300);
    }, delay);

  } catch (error) {
    logError('Error animating element in:', error);
  }
}

/**
 * Animate number change
 */
export function animateNumberChange(element, fromValue, toValue, duration = 500) {
  if (!element || !isInitialized) return;

  const startTime = performance.now();
  const difference = toValue - fromValue;

  function updateNumber(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const currentValue = Math.round(fromValue + difference * easedProgress);
    
    element.textContent = currentValue.toLocaleString();
    
    if (progress < 1) {
      requestAnimationFrame(updateNumber);
    }
  }

  requestAnimationFrame(updateNumber);
}

/**
 * Create floating text animation
 */
export function showFloatingText(text, x, y, options = {}) {
  if (!isInitialized || ANIMATION_CONFIG.reducedMotion) return;

  try {
    const floatingElement = document.createElement('div');
    floatingElement.textContent = text;
    floatingElement.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      color: ${options.color || '#00ff88'};
      font-size: ${options.fontSize || '24px'};
      font-weight: bold;
      pointer-events: none;
      z-index: 2000;
      transform: translate(-50%, -50%);
      text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
    `;
    
    document.body.appendChild(floatingElement);
    
    // Animate the floating text
    const animation = floatingElement.animate([
      { 
        transform: 'translate(-50%, -50%) scale(0.5)', 
        opacity: 0 
      },
      { 
        transform: 'translate(-50%, -100%) scale(1.2)', 
        opacity: 1,
        offset: 0.3
      },
      { 
        transform: 'translate(-50%, -150%) scale(1)', 
        opacity: 0 
      }
    ], {
      duration: options.duration || 1500,
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    });
    
    animation.onfinish = () => {
      if (floatingElement.parentNode) {
        floatingElement.parentNode.removeChild(floatingElement);
      }
    };

  } catch (error) {
    logError('Error showing floating text:', error);
  }
}

/**
 * Screen shake effect
 */
export function screenShake(intensity = 5, duration = 300) {
  if (!isInitialized || ANIMATION_CONFIG.reducedMotion) return;

  try {
    const appElement = document.getElementById('app');
    if (!appElement) return;

    const originalTransform = appElement.style.transform;
    let startTime = performance.now();

    function shake(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = elapsed / duration;
      
      if (progress >= 1) {
        appElement.style.transform = originalTransform;
        return;
      }
      
      const currentIntensity = intensity * (1 - progress);
      const offsetX = (Math.random() - 0.5) * currentIntensity;
      const offsetY = (Math.random() - 0.5) * currentIntensity;
      
      appElement.style.transform = `${originalTransform} translate(${offsetX}px, ${offsetY}px)`;
      
      requestAnimationFrame(shake);
    }

    requestAnimationFrame(shake);

  } catch (error) {
    logError('Error triggering screen shake:', error);
  }
}

/**
 * Pulse effect for elements
 */
export function pulseElement(element, options = {}) {
  if (!element || !isInitialized || ANIMATION_CONFIG.reducedMotion) return;

  try {
    const animation = element.animate([
      { transform: 'scale(1)', opacity: 1 },
      { transform: `scale(${options.scale || 1.1})`, opacity: options.opacity || 0.8 },
      { transform: 'scale(1)', opacity: 1 }
    ], {
      duration: options.duration || 400,
      easing: ANIMATION_CONFIG.easing.easeInOut,
      iterations: options.iterations || 1
    });

    return animation;

  } catch (error) {
    logError('Error pulsing element:', error);
    return null;
  }
}

/**
 * Check if animations are enabled
 */
export function areAnimationsEnabled() {
  return isInitialized && !ANIMATION_CONFIG.reducedMotion;
}

/**
 * Get animation duration based on user preferences
 */
export function getAnimationDuration(type = 'normal') {
  if (ANIMATION_CONFIG.reducedMotion) return 10; // Nearly instant
  
  const durations = {
    fast: 150,
    normal: 300,
    slow: 600
  };
  
  return durations[type] || durations.normal;
}

/**
 * Cleanup animations
 */
export function cleanup() {
  try {
    // Stop all active animations
    activeAnimations.forEach(animation => {
      if (animation && animation.cancel) {
        animation.cancel();
      }
    });
    activeAnimations.clear();

    // Cleanup particle system
    if (particleSystem) {
      particleSystem.destroy();
      particleSystem = null;
    }

    // Cancel animation frame
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    isInitialized = false;
    logDev('Animation system cleaned up');

  } catch (error) {
    logError('Error cleaning up animations:', error);
  }
}

// Handle reduced motion preference changes
if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  mediaQuery.addEventListener('change', (e) => {
    ANIMATION_CONFIG.reducedMotion = e.matches;
    logDev('Reduced motion preference changed:', e.matches);
    
    if (e.matches && particleSystem) {
      particleSystem.clear();
    }
  });
}

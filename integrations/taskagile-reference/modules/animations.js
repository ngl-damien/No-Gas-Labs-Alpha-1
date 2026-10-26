
/**
 * Animations Module - Handles all visual effects and animations
 * Implements performance-optimized animations with reduced motion support
 */

import { logDev } from './testing.js';

// Animation configuration
const ANIMATION_CONFIG = {
  slapButton: {
    duration: 150,
    scale: 0.95,
    glowIntensity: 1.5
  },
  floatingPoints: {
    duration: 2000,
    distance: 100,
    fadeStart: 0.7
  },
  combo: {
    duration: 1000,
    pulseScale: 1.2,
    glowDuration: 2000
  },
  powerUp: {
    duration: 800,
    particles: 12,
    colors: ['#00ff88', '#ff0088', '#0088ff', '#ffaa00']
  },
  achievement: {
    duration: 3000,
    bounceScale: 1.1,
    glowPulses: 3
  }
};

// Animation state
let animationQueue = [];
let isReducedMotion = false;
let activeAnimations = new Set();

/**
 * Initialize animations system
 */
export function initAnimations() {
  // Check for reduced motion preference
  isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  
  // Listen for changes in motion preferences
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
    isReducedMotion = e.matches;
    
    if (isReducedMotion) {
      // Cancel all active animations
      activeAnimations.forEach(animation => {
        if (animation.cancel) animation.cancel();
      });
      activeAnimations.clear();
    }
  });
  
  // Create particle system container
  createParticleContainer();
  
  // Set up CSS custom properties for animations
  setupAnimationVariables();
  
  logDev('✅ Animations system initialized', { reducedMotion: isReducedMotion });
}

/**
 * Trigger slap button animation
 */
export function triggerSlapAnimation(points = 1) {
  const button = document.getElementById('slap-btn');
  if (!button || isReducedMotion) return;
  
  // Button press effect
  const pressAnimation = button.animate([
    { transform: 'scale(1)', filter: 'drop-shadow(0 0 10px var(--neon-green))' },
    { transform: `scale(${ANIMATION_CONFIG.slapButton.scale})`, filter: 'drop-shadow(0 0 20px var(--neon-green))' },
    { transform: 'scale(1)', filter: 'drop-shadow(0 0 10px var(--neon-green))' }
  ], {
    duration: ANIMATION_CONFIG.slapButton.duration,
    easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)'
  });
  
  activeAnimations.add(pressAnimation);
  
  pressAnimation.addEventListener('finish', () => {
    activeAnimations.delete(pressAnimation);
  });
  
  // Create ripple effect
  createRippleEffect(button);
  
  // Trigger floating points
  triggerFloatingPoints(points, button);
}

/**
 * Trigger combo animation
 */
export function triggerComboAnimation(combo) {
  const comboEl = document.getElementById('combo');
  if (!comboEl || isReducedMotion) return;
  
  // Combo pulse effect
  const pulseAnimation = comboEl.animate([
    { transform: 'scale(1)', filter: 'none' },
    { transform: `scale(${ANIMATION_CONFIG.combo.pulseScale})`, filter: 'drop-shadow(0 0 15px var(--electric-blue))' },
    { transform: 'scale(1)', filter: 'none' }
  ], {
    duration: ANIMATION_CONFIG.combo.duration,
    easing: 'ease-out'
  });
  
  activeAnimations.add(pulseAnimation);
  
  // Create combo particles
  if (combo > 5) {
    createComboParticles(comboEl, combo);
  }
  
  // Screen shake for high combos
  if (combo > 10) {
    triggerScreenShake();
  }
  
  pulseAnimation.addEventListener('finish', () => {
    activeAnimations.delete(pulseAnimation);
  });
}

/**
 * Trigger power-up activation animation
 */
export function triggerPowerUpAnimation(powerUpId, element) {
  if (!element || isReducedMotion) return;
  
  // Power-up activation effect
  const activationAnimation = element.animate([
    { transform: 'scale(1) rotate(0deg)', filter: 'brightness(1)' },
    { transform: 'scale(1.1) rotate(5deg)', filter: 'brightness(1.5) drop-shadow(0 0 20px var(--neon-green))' },
    { transform: 'scale(1) rotate(0deg)', filter: 'brightness(1.2)' }
  ], {
    duration: ANIMATION_CONFIG.powerUp.duration,
    easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)'
  });
  
  activeAnimations.add(activationAnimation);
  
  // Create power-up particles
  createPowerUpParticles(element, powerUpId);
  
  activationAnimation.addEventListener('finish', () => {
    activeAnimations.delete(activationAnimation);
  });
}

/**
 * Trigger achievement unlock animation
 */
export function triggerAchievementAnimation(achievementId) {
  if (isReducedMotion) return;
  
  // Create achievement popup
  const popup = createAchievementPopup(achievementId);
  document.body.appendChild(popup);
  
  // Animate popup entrance
  const entranceAnimation = popup.animate([
    { 
      transform: 'translate(-50%, -50%) scale(0) rotate(-180deg)', 
      opacity: 0,
      filter: 'blur(10px)'
    },
    { 
      transform: 'translate(-50%, -50%) scale(1.1) rotate(0deg)', 
      opacity: 1,
      filter: 'blur(0px)'
    },
    { 
      transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', 
      opacity: 1,
      filter: 'blur(0px)'
    }
  ], {
    duration: ANIMATION_CONFIG.achievement.duration * 0.3,
    easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)'
  });
  
  activeAnimations.add(entranceAnimation);
  
  // Auto-remove after delay
  setTimeout(() => {
    const exitAnimation = popup.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: 'translate(-50%, -50%) scale(0)', opacity: 0 }
    ], {
      duration: 500,
      easing: 'ease-in'
    });
    
    exitAnimation.addEventListener('finish', () => {
      popup.remove();
      activeAnimations.delete(exitAnimation);
    });
  }, ANIMATION_CONFIG.achievement.duration);
  
  entranceAnimation.addEventListener('finish', () => {
    activeAnimations.delete(entranceAnimation);
  });
}

/**
 * Create floating points animation
 */
function triggerFloatingPoints(points, sourceElement) {
  if (!sourceElement) return;
  
  const rect = sourceElement.getBoundingClientRect();
  const container = document.getElementById('floating-points');
  if (!container) return;
  
  const floatingPoint = document.createElement('div');
  floatingPoint.className = 'floating-point-animation';
  floatingPoint.textContent = `+${points}`;
  
  // Position at source element
  floatingPoint.style.left = `${rect.left + rect.width / 2}px`;
  floatingPoint.style.top = `${rect.top + rect.height / 2}px`;
  
  container.appendChild(floatingPoint);
  
  if (isReducedMotion) {
    // Simple fade for reduced motion
    floatingPoint.style.opacity = '0';
    setTimeout(() => floatingPoint.remove(), 1000);
    return;
  }
  
  // Animate floating up and fading out
  const floatingAnimation = floatingPoint.animate([
    { 
      transform: 'translate(-50%, -50%) scale(1)', 
      opacity: 1,
      filter: 'blur(0px)'
    },
    { 
      transform: `translate(-50%, -${ANIMATION_CONFIG.floatingPoints.distance}px) scale(1.2)`, 
      opacity: ANIMATION_CONFIG.floatingPoints.fadeStart,
      filter: 'blur(0px)'
    },
    { 
      transform: `translate(-50%, -${ANIMATION_CONFIG.floatingPoints.distance * 1.5}px) scale(0.8)`, 
      opacity: 0,
      filter: 'blur(3px)'
    }
  ], {
    duration: ANIMATION_CONFIG.floatingPoints.duration,
    easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
  });
  
  activeAnimations.add(floatingAnimation);
  
  floatingAnimation.addEventListener('finish', () => {
    floatingPoint.remove();
    activeAnimations.delete(floatingAnimation);
  });
}

/**
 * Create ripple effect on button
 */
function createRippleEffect(button) {
  if (isReducedMotion) return;
  
  const ripple = document.createElement('div');
  ripple.className = 'ripple-effect';
  
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${rect.width / 2 - size / 2}px`;
  ripple.style.top = `${rect.height / 2 - size / 2}px`;
  
  button.appendChild(ripple);
  
  const rippleAnimation = ripple.animate([
    { transform: 'scale(0)', opacity: 1 },
    { transform: 'scale(1)', opacity: 0 }
  ], {
    duration: 600,
    easing: 'ease-out'
  });
  
  activeAnimations.add(rippleAnimation);
  
  rippleAnimation.addEventListener('finish', () => {
    ripple.remove();
    activeAnimations.delete(rippleAnimation);
  });
}

/**
 * Create combo particles
 */
function createComboParticles(comboElement, combo) {
  if (isReducedMotion) return;
  
  const rect = comboElement.getBoundingClientRect();
  const particleCount = Math.min(combo, 20); // Cap particles for performance
  
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'combo-particle';
    
    const angle = (Math.PI * 2 * i) / particleCount;
    const velocity = 50 + Math.random() * 100;
    const endX = Math.cos(angle) * velocity;
    const endY = Math.sin(angle) * velocity;
    
    particle.style.left = `${rect.left + rect.width / 2}px`;
    particle.style.top = `${rect.top + rect.height / 2}px`;
    particle.style.background = ANIMATION_CONFIG.powerUp.colors[i % ANIMATION_CONFIG.powerUp.colors.length];
    
    document.body.appendChild(particle);
    
    const particleAnimation = particle.animate([
      { 
        transform: 'translate(-50%, -50%) scale(0)', 
        opacity: 1 
      },
      { 
        transform: 'translate(-50%, -50%) scale(1)', 
        opacity: 1 
      },
      { 
        transform: `translate(${endX}px, ${endY}px) scale(0)`, 
        opacity: 0 
      }
    ], {
      duration: 1000 + Math.random() * 500,
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    });
    
    activeAnimations.add(particleAnimation);
    
    particleAnimation.addEventListener('finish', () => {
      particle.remove();
      activeAnimations.delete(particleAnimation);
    });
  }
}

/**
 * Create power-up particles
 */
function createPowerUpParticles(element, powerUpId) {
  if (isReducedMotion) return;
  
  const rect = element.getBoundingClientRect();
  const colors = ANIMATION_CONFIG.powerUp.colors;
  
  for (let i = 0; i < ANIMATION_CONFIG.powerUp.particles; i++) {
    const particle = document.createElement('div');
    particle.className = 'powerup-particle';
    
    const angle = (Math.PI * 2 * i) / ANIMATION_CONFIG.powerUp.particles;
    const distance = 80 + Math.random() * 40;
    const endX = rect.left + rect.width / 2 + Math.cos(angle) * distance;
    const endY = rect.top + rect.height / 2 + Math.sin(angle) * distance;
    
    particle.style.left = `${rect.left + rect.width / 2}px`;
    particle.style.top = `${rect.top + rect.height / 2}px`;
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    
    document.body.appendChild(particle);
    
    const particleAnimation = particle.animate([
      { 
        transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', 
        opacity: 1 
      },
      { 
        transform: `translate(${endX - rect.left - rect.width / 2}px, ${endY - rect.top - rect.height / 2}px) scale(0.5) rotate(360deg)`, 
        opacity: 0 
      }
    ], {
      duration: ANIMATION_CONFIG.powerUp.duration + Math.random() * 400,
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    });
    
    activeAnimations.add(particleAnimation);
    
    particleAnimation.addEventListener('finish', () => {
      particle.remove();
      activeAnimations.delete(particleAnimation);
    });
  }
}

/**
 * Trigger screen shake effect
 */
function triggerScreenShake(intensity = 10, duration = 300) {
  if (isReducedMotion) return;
  
  const appContainer = document.querySelector('.app-container');
  if (!appContainer) return;
  
  const shakeAnimation = appContainer.animate([
    { transform: 'translate(0, 0)' },
    { transform: `translate(${intensity}px, ${intensity}px)` },
    { transform: `translate(-${intensity}px, -${intensity}px)` },
    { transform: `translate(${intensity}px, -${intensity}px)` },
    { transform: `translate(-${intensity}px, ${intensity}px)` },
    { transform: 'translate(0, 0)' }
  ], {
    duration: duration,
    easing: 'linear'
  });
  
  activeAnimations.add(shakeAnimation);
  
  shakeAnimation.addEventListener('finish', () => {
    activeAnimations.delete(shakeAnimation);
  });
}

/**
 * Create achievement popup
 */
function createAchievementPopup(achievementId) {
  const popup = document.createElement('div');
  popup.className = 'achievement-popup';
  popup.innerHTML = `
    <div class="achievement-content">
      <div class="achievement-icon">🏆</div>
      <div class="achievement-text">
        <h3>Achievement Unlocked!</h3>
        <p>${getAchievementTitle(achievementId)}</p>
      </div>
    </div>
  `;
  
  popup.style.position = 'fixed';
  popup.style.top = '50%';
  popup.style.left = '50%';
  popup.style.transform = 'translate(-50%, -50%)';
  popup.style.zIndex = '10000';
  
  return popup;
}

/**
 * Get achievement title by ID
 */
function getAchievementTitle(achievementId) {
  const achievements = {
    score_100: 'First 100 Points',
    score_500: 'Getting Started',
    score_1000: '1K Milestone',
    score_5000: 'Slap Master',
    score_10000: 'Elite Slapper',
    score_50000: 'Legendary',
    score_100000: 'Ultimate Champion',
    combo_10: '10x Combo Master',
    combo_25: '25x Combo Beast'
  };
  
  return achievements[achievementId] || 'Special Achievement';
}

/**
 * Create particle system container
 */
function createParticleContainer() {
  let container = document.getElementById('particle-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'particle-container';
    container.className = 'particle-container';
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '1000';
    document.body.appendChild(container);
  }
}

/**
 * Set up CSS custom properties for animations
 */
function setupAnimationVariables() {
  const root = document.documentElement;
  
  // Dynamic animation durations based on device performance
  const performanceLevel = getPerformanceLevel();
  const durationMultiplier = performanceLevel === 'high' ? 1 : performanceLevel === 'medium' ? 1.2 : 1.5;
  
  root.style.setProperty('--animation-duration-fast', `${100 * durationMultiplier}ms`);
  root.style.setProperty('--animation-duration-normal', `${300 * durationMultiplier}ms`);
  root.style.setProperty('--animation-duration-slow', `${600 * durationMultiplier}ms`);
  
  // Reduced motion overrides
  if (isReducedMotion) {
    root.style.setProperty('--animation-duration-fast', '50ms');
    root.style.setProperty('--animation-duration-normal', '100ms');
    root.style.setProperty('--animation-duration-slow', '200ms');
  }
}

/**
 * Detect device performance level
 */
function getPerformanceLevel() {
  // Simple performance detection based on device capabilities
  if (navigator.deviceMemory && navigator.deviceMemory >= 8) return 'high';
  if (navigator.hardwareConcurrency && navigator.hardwareConcurrency >= 4) return 'medium';
  return 'low';
}

/**
 * Queue animation for batch processing
 */
export function queueAnimation(animationFn, priority = 'normal') {
  animationQueue.push({ fn: animationFn, priority });
  
  if (animationQueue.length === 1) {
    processAnimationQueue();
  }
}

/**
 * Process animation queue
 */
function processAnimationQueue() {
  if (animationQueue.length === 0) return;
  
  // Sort by priority
  animationQueue.sort((a, b) => {
    const priorityOrder = { high: 3, normal: 2, low: 1 };
    return (priorityOrder[b.priority] || 2) - (priorityOrder[a.priority] || 2);
  });
  
  const animation = animationQueue.shift();
  
  requestAnimationFrame(() => {
    animation.fn();
    
    // Process next animation
    if (animationQueue.length > 0) {
      setTimeout(processAnimationQueue, 16); // ~60fps
    }
  });
}

/**
 * Cleanup animations
 */
export function cleanup() {
  // Cancel all active animations
  activeAnimations.forEach(animation => {
    if (animation.cancel) animation.cancel();
  });
  activeAnimations.clear();
  
  // Clear animation queue
  animationQueue = [];
  
  // Remove particle containers
  const containers = document.querySelectorAll('.particle-container, #floating-points, #particle-container');
  containers.forEach(container => container.remove());
}

// Export for debugging
if (window.location.hostname === 'localhost') {
  window.animationDebug = {
    activeAnimations: activeAnimations.size,
    queueLength: () => animationQueue.length,
    isReducedMotion,
    cleanup
  };
}

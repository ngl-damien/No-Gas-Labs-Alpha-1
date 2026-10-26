
/**
 * Audio Module - Handles all sound effects, music, and audio feedback
 * Implements Web Audio API with fallback to HTML5 audio
 */

import { logDev, logError } from './testing.js';

// Audio configuration
const AUDIO_CONFIG = {
  masterVolume: 0.7,
  sfxVolume: 0.8,
  musicVolume: 0.4,
  fadeTime: 1000,
  maxConcurrentSounds: 8,
  audioFormats: ['mp3', 'ogg', 'wav'],
  preloadSounds: true
};

// Audio state
let audioContext = null;
let masterGainNode = null;
let sfxGainNode = null;
let musicGainNode = null;
let isMuted = false;
let isInitialized = false;
let audioBuffers = new Map();
let activeSounds = new Set();
let backgroundMusic = null;

// Sound definitions
const SOUNDS = {
  hit: {
    url: './client/public/sounds/hit.mp3',
    volume: 0.6,
    variations: 1
  },
  success: {
    url: './client/public/sounds/success.mp3',
    volume: 0.8,
    variations: 1
  },
  background: {
    url: './client/public/sounds/background.mp3',
    volume: 0.3,
    loop: true,
    type: 'music'
  },
  combo: {
    // Generated dynamically based on combo level
    type: 'synthesized',
    baseFreq: 220,
    volume: 0.5
  },
  powerup: {
    type: 'synthesized',
    baseFreq: 440,
    volume: 0.7
  },
  achievement: {
    type: 'synthesized',
    baseFreq: 523,
    volume: 0.8
  },
  error: {
    type: 'synthesized',
    baseFreq: 110,
    volume: 0.6
  },
  notification: {
    type: 'synthesized',
    baseFreq: 880,
    volume: 0.5
  }
};

/**
 * Initialize audio system
 */
export async function initAudio() {
  try {
    // Create audio context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create gain nodes for volume control
    masterGainNode = audioContext.createGain();
    sfxGainNode = audioContext.createGain();
    musicGainNode = audioContext.createGain();
    
    // Connect gain nodes
    sfxGainNode.connect(masterGainNode);
    musicGainNode.connect(masterGainNode);
    masterGainNode.connect(audioContext.destination);
    
    // Set initial volumes
    setMasterVolume(AUDIO_CONFIG.masterVolume);
    setSfxVolume(AUDIO_CONFIG.sfxVolume);
    setMusicVolume(AUDIO_CONFIG.musicVolume);
    
    // Load mute state from localStorage
    const savedMuteState = localStorage.getItem('ngs_audio_muted');
    if (savedMuteState === 'true') {
      toggleMute();
    }
    
    // Preload audio files
    if (AUDIO_CONFIG.preloadSounds) {
      await preloadAudio();
    }
    
    // Set up audio event listeners
    setupAudioEventListeners();
    
    isInitialized = true;
    logDev('✅ Audio system initialized successfully');
    
  } catch (error) {
    logError('Failed to initialize audio system:', error);
    // Fallback to silent mode
    isInitialized = false;
  }
}

/**
 * Play hit sound with variations
 */
export function playHitSound() {
  if (!isInitialized || isMuted) return;
  
  const sound = SOUNDS.hit;
  playSound('hit', {
    volume: sound.volume,
    pitch: 1 + (Math.random() - 0.5) * 0.2 // Slight pitch variation
  });
}

/**
 * Play success sound
 */
export function playSuccessSound() {
  if (!isInitialized || isMuted) return;
  
  playSound('success', {
    volume: SOUNDS.success.volume
  });
}

/**
 * Play combo sound with increasing pitch
 */
export function playComboSound(comboLevel) {
  if (!isInitialized || isMuted) return;
  
  const sound = SOUNDS.combo;
  const pitchMultiplier = Math.min(1 + (comboLevel * 0.1), 3); // Max 3x pitch
  
  playSynthesizedSound(sound.baseFreq * pitchMultiplier, {
    volume: sound.volume,
    duration: 200,
    waveform: 'sawtooth',
    envelope: {
      attack: 0.01,
      decay: 0.1,
      sustain: 0.3,
      release: 0.1
    }
  });
}

/**
 * Play power-up activation sound
 */
export function playPowerUpSound() {
  if (!isInitialized || isMuted) return;
  
  const sound = SOUNDS.powerup;
  playSynthesizedSound(sound.baseFreq, {
    volume: sound.volume,
    duration: 500,
    waveform: 'square',
    envelope: {
      attack: 0.05,
      decay: 0.2,
      sustain: 0.5,
      release: 0.3
    },
    filter: {
      type: 'lowpass',
      frequency: 2000,
      Q: 1
    }
  });
}

/**
 * Play achievement unlock sound
 */
export function playAchievementSound() {
  if (!isInitialized || isMuted) return;
  
  const sound = SOUNDS.achievement;
  
  // Play a chord progression
  const frequencies = [
    sound.baseFreq,        // C5
    sound.baseFreq * 1.25, // E5
    sound.baseFreq * 1.5,  // G5
    sound.baseFreq * 2     // C6
  ];
  
  frequencies.forEach((freq, index) => {
    setTimeout(() => {
      playSynthesizedSound(freq, {
        volume: sound.volume * 0.7,
        duration: 800,
        waveform: 'sine',
        envelope: {
          attack: 0.1,
          decay: 0.3,
          sustain: 0.4,
          release: 0.4
        }
      });
    }, index * 100);
  });
}

/**
 * Play error sound
 */
export function playErrorSound() {
  if (!isInitialized || isMuted) return;
  
  const sound = SOUNDS.error;
  playSynthesizedSound(sound.baseFreq, {
    volume: sound.volume,
    duration: 300,
    waveform: 'sawtooth',
    envelope: {
      attack: 0.05,
      decay: 0.1,
      sustain: 0.2,
      release: 0.15
    }
  });
}

/**
 * Play notification sound
 */
export function playNotificationSound() {
  if (!isInitialized || isMuted) return;
  
  const sound = SOUNDS.notification;
  playSynthesizedSound(sound.baseFreq, {
    volume: sound.volume,
    duration: 200,
    waveform: 'sine',
    envelope: {
      attack: 0.01,
      decay: 0.05,
      sustain: 0.7,
      release: 0.15
    }
  });
}

/**
 * Start background music
 */
export function startBackgroundMusic() {
  if (!isInitialized || isMuted || backgroundMusic) return;
  
  playSound('background', {
    volume: SOUNDS.background.volume,
    loop: true,
    type: 'music'
  }).then(sound => {
    backgroundMusic = sound;
  });
}

/**
 * Stop background music
 */
export function stopBackgroundMusic() {
  if (backgroundMusic) {
    fadeOut(backgroundMusic, AUDIO_CONFIG.fadeTime);
    backgroundMusic = null;
  }
}

/**
 * Toggle mute state
 */
export function toggleMute() {
  isMuted = !isMuted;
  
  if (isMuted) {
    setMasterVolume(0);
    stopBackgroundMusic();
  } else {
    setMasterVolume(AUDIO_CONFIG.masterVolume);
    if (SOUNDS.background && !backgroundMusic) {
      startBackgroundMusic();
    }
  }
  
  // Save mute state
  localStorage.setItem('ngs_audio_muted', isMuted.toString());
  
  // Update UI
  updateMuteButton();
  
  return isMuted;
}

/**
 * Get current mute state
 */
export function isMutedState() {
  return isMuted;
}

/**
 * Play a sound by name
 */
async function playSound(soundName, options = {}) {
  if (!isInitialized || isMuted) return null;
  
  const sound = SOUNDS[soundName];
  if (!sound) {
    logError('Sound not found:', soundName);
    return null;
  }
  
  try {
    let source;
    
    if (sound.type === 'synthesized') {
      return playSynthesizedSound(sound.baseFreq, options);
    }
    
    // Check if we have a preloaded buffer
    const buffer = audioBuffers.get(soundName);
    if (buffer) {
      source = audioContext.createBufferSource();
      source.buffer = buffer;
    } else {
      // Load and play audio file
      const audioBuffer = await loadAudioFile(sound.url);
      if (!audioBuffer) return null;
      
      source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // Cache the buffer
      audioBuffers.set(soundName, audioBuffer);
    }
    
    // Create gain node for this sound
    const gainNode = audioContext.createGain();
    gainNode.gain.value = (options.volume || 1) * (sound.volume || 1);
    
    // Apply pitch if specified
    if (options.pitch) {
      source.playbackRate.value = options.pitch;
    }
    
    // Connect nodes
    source.connect(gainNode);
    
    if (options.type === 'music') {
      gainNode.connect(musicGainNode);
    } else {
      gainNode.connect(sfxGainNode);
    }
    
    // Set loop if specified
    if (options.loop) {
      source.loop = true;
    }
    
    // Limit concurrent sounds
    if (activeSounds.size >= AUDIO_CONFIG.maxConcurrentSounds) {
      const oldestSound = activeSounds.values().next().value;
      if (oldestSound && oldestSound.stop) {
        oldestSound.stop();
      }
    }
    
    // Track active sound
    activeSounds.add(source);
    
    // Clean up when sound ends
    source.addEventListener('ended', () => {
      activeSounds.delete(source);
    });
    
    // Start playing
    source.start(0);
    
    return source;
    
  } catch (error) {
    logError('Error playing sound:', soundName, error);
    return null;
  }
}

/**
 * Play synthesized sound
 */
function playSynthesizedSound(frequency, options = {}) {
  if (!isInitialized || isMuted) return null;
  
  try {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const filterNode = audioContext.createBiquadFilter();
    
    // Set oscillator properties
    oscillator.type = options.waveform || 'sine';
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    
    // Set filter properties
    if (options.filter) {
      filterNode.type = options.filter.type;
      filterNode.frequency.setValueAtTime(options.filter.frequency, audioContext.currentTime);
      filterNode.Q.setValueAtTime(options.filter.Q, audioContext.currentTime);
    }
    
    // Set up envelope
    const envelope = options.envelope || { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.2 };
    const duration = options.duration || 500;
    const volume = options.volume || 0.5;
    const now = audioContext.currentTime;
    
    // ADSR envelope
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(volume, now + envelope.attack);
    gainNode.gain.linearRampToValueAtTime(volume * envelope.sustain, now + envelope.attack + envelope.decay);
    gainNode.gain.setValueAtTime(volume * envelope.sustain, now + duration / 1000 - envelope.release);
    gainNode.gain.linearRampToValueAtTime(0, now + duration / 1000);
    
    // Connect nodes
    oscillator.connect(options.filter ? filterNode : gainNode);
    if (options.filter) filterNode.connect(gainNode);
    gainNode.connect(sfxGainNode);
    
    // Track active sound
    activeSounds.add(oscillator);
    
    // Start and stop
    oscillator.start(now);
    oscillator.stop(now + duration / 1000);
    
    oscillator.addEventListener('ended', () => {
      activeSounds.delete(oscillator);
    });
    
    return oscillator;
    
  } catch (error) {
    logError('Error playing synthesized sound:', error);
    return null;
  }
}

/**
 * Load audio file
 */
async function loadAudioFile(url) {
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return audioBuffer;
  } catch (error) {
    logError('Error loading audio file:', url, error);
    return null;
  }
}

/**
 * Preload audio files
 */
async function preloadAudio() {
  const preloadPromises = Object.entries(SOUNDS)
    .filter(([_, sound]) => sound.url && sound.type !== 'synthesized')
    .map(async ([name, sound]) => {
      try {
        const buffer = await loadAudioFile(sound.url);
        if (buffer) {
          audioBuffers.set(name, buffer);
          logDev(`Preloaded audio: ${name}`);
        }
      } catch (error) {
        logError(`Failed to preload audio: ${name}`, error);
      }
    });
  
  await Promise.allSettled(preloadPromises);
  logDev(`Audio preloading completed. Loaded ${audioBuffers.size} sounds.`);
}

/**
 * Fade out audio
 */
function fadeOut(source, duration) {
  if (!source || !audioContext) return;
  
  const gainNode = audioContext.createGain();
  gainNode.gain.setValueAtTime(1, audioContext.currentTime);
  gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration / 1000);
  
  setTimeout(() => {
    if (source.stop) source.stop();
  }, duration);
}

/**
 * Set master volume
 */
function setMasterVolume(volume) {
  if (masterGainNode) {
    masterGainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  }
}

/**
 * Set SFX volume
 */
function setSfxVolume(volume) {
  if (sfxGainNode) {
    sfxGainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  }
}

/**
 * Set music volume
 */
function setMusicVolume(volume) {
  if (musicGainNode) {
    musicGainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  }
}

/**
 * Set up audio event listeners
 */
function setupAudioEventListeners() {
  // Resume audio context on user interaction (required by browsers)
  const resumeAudio = () => {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        logDev('Audio context resumed');
      });
    }
  };
  
  // Add event listeners for user interaction
  ['click', 'touchstart', 'keydown'].forEach(eventType => {
    document.addEventListener(eventType, resumeAudio, { once: true });
  });
  
  // Handle page visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Page is hidden - pause audio
      if (backgroundMusic) {
        stopBackgroundMusic();
      }
    } else {
      // Page is visible - resume audio
      if (!isMuted && SOUNDS.background && !backgroundMusic) {
        setTimeout(() => startBackgroundMusic(), 1000);
      }
    }
  });
}

/**
 * Update mute button appearance
 */
function updateMuteButton() {
  const soundBtn = document.getElementById('sound-btn');
  if (!soundBtn) return;
  
  const icon = soundBtn.querySelector('svg path');
  if (!icon) return;
  
  if (isMuted) {
    // Muted icon
    icon.setAttribute('d', 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z');
    soundBtn.setAttribute('aria-label', 'Unmute sound');
  } else {
    // Unmuted icon
    icon.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z');
    soundBtn.setAttribute('aria-label', 'Mute sound');
  }
}

/**
 * Cleanup audio resources
 */
export function cleanup() {
  // Stop all active sounds
  activeSounds.forEach(source => {
    if (source.stop) source.stop();
  });
  activeSounds.clear();
  
  // Stop background music
  stopBackgroundMusic();
  
  // Close audio context
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
  }
  
  // Clear buffers
  audioBuffers.clear();
  
  isInitialized = false;
}

// Export for debugging
if (window.location.hostname === 'localhost') {
  window.audioDebug = {
    audioContext,
    activeSounds: activeSounds.size,
    buffersLoaded: audioBuffers.size,
    isMuted,
    cleanup
  };
}

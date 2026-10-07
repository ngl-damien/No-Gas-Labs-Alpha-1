/**
 * Audio Module
 * Handles sound effects, background music, and audio management
 */

import { logError, logInfo, logDev } from './testing.js';
import { loadState, saveState } from './persistence.js';

// Audio configuration
const AUDIO_SETTINGS_KEY = 'ngs_audio_settings';
const AUDIO_CACHE_KEY = 'ngs_audio_cache';

// Audio files mapping
const AUDIO_FILES = {
  hit: '/sounds/hit.mp3',
  success: '/sounds/success.mp3',
  background: '/sounds/background.mp3'
};

// Audio state
let audioContext = null;
let audioBuffers = new Map();
let audioSettings = {
  masterVolume: 0.7,
  sfxVolume: 0.8,
  musicVolume: 0.5,
  muted: false
};

let backgroundMusic = null;
let isBackgroundMusicPlaying = false;
let isAudioInitialized = false;
let audioLoadingPromises = new Map();

// Web Audio nodes
let masterGainNode = null;
let sfxGainNode = null;
let musicGainNode = null;

/**
 * Initialize audio system
 */
export async function initAudio() {
  try {
    logInfo('🔊 Initializing audio system...');

    // Load audio settings
    await loadAudioSettings();

    // Initialize Web Audio API
    await initWebAudio();

    // Load audio files
    await loadAudioFiles();

    // Set up audio nodes
    setupAudioNodes();

    isAudioInitialized = true;
    logInfo('✅ Audio system initialized');

  } catch (error) {
    logError('Error initializing audio:', error);
    // Continue without audio rather than breaking the app
  }
}

/**
 * Initialize Web Audio Context
 */
async function initWebAudio() {
  try {
    // Create audio context
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Web Audio API not supported');
    }

    audioContext = new AudioContextClass();

    // Handle browser autoplay restrictions
    if (audioContext.state === 'suspended') {
      logDev('Audio context suspended - will resume on user interaction');
      
      // Resume on first user interaction
      const resumeAudio = async () => {
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
          logDev('Audio context resumed');
        }
        
        // Remove listeners after first interaction
        document.removeEventListener('click', resumeAudio);
        document.removeEventListener('touchstart', resumeAudio);
        document.removeEventListener('keydown', resumeAudio);
      };

      document.addEventListener('click', resumeAudio, { once: true });
      document.addEventListener('touchstart', resumeAudio, { once: true });
      document.addEventListener('keydown', resumeAudio, { once: true });
    }

  } catch (error) {
    logError('Error initializing Web Audio:', error);
    throw error;
  }
}

/**
 * Set up audio nodes and routing
 */
function setupAudioNodes() {
  if (!audioContext) return;

  try {
    // Create gain nodes for volume control
    masterGainNode = audioContext.createGain();
    sfxGainNode = audioContext.createGain();
    musicGainNode = audioContext.createGain();

    // Connect nodes
    sfxGainNode.connect(masterGainNode);
    musicGainNode.connect(masterGainNode);
    masterGainNode.connect(audioContext.destination);

    // Set initial volumes
    updateAudioVolumes();

    logDev('Audio nodes setup complete');

  } catch (error) {
    logError('Error setting up audio nodes:', error);
  }
}

/**
 * Load audio files
 */
async function loadAudioFiles() {
  const loadPromises = Object.entries(AUDIO_FILES).map(async ([key, url]) => {
    try {
      if (audioLoadingPromises.has(key)) {
        return audioLoadingPromises.get(key);
      }

      const loadPromise = loadAudioFile(key, url);
      audioLoadingPromises.set(key, loadPromise);
      
      return loadPromise;

    } catch (error) {
      logError(`Error loading audio file ${key}:`, error);
      return null;
    }
  });

  await Promise.allSettled(loadPromises);
  logDev('Audio files loading completed');
}

/**
 * Load individual audio file
 */
async function loadAudioFile(key, url) {
  try {
    logDev(`Loading audio file: ${key} from ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    audioBuffers.set(key, audioBuffer);
    logDev(`Audio file loaded: ${key}`);

    return audioBuffer;

  } catch (error) {
    logError(`Error loading audio file ${key}:`, error);
    
    // Create silent buffer as fallback
    const fallbackBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.1, audioContext.sampleRate);
    audioBuffers.set(key, fallbackBuffer);
    
    return null;
  }
}

/**
 * Play hit sound effect
 */
export function playHitSound(volume = 1) {
  if (!isAudioInitialized || audioSettings.muted) return;

  try {
    const buffer = audioBuffers.get('hit');
    if (!buffer) return;

    playSound(buffer, sfxGainNode, volume * audioSettings.sfxVolume);

  } catch (error) {
    logError('Error playing hit sound:', error);
  }
}

/**
 * Play success sound effect
 */
export function playSuccessSound(volume = 1) {
  if (!isAudioInitialized || audioSettings.muted) return;

  try {
    const buffer = audioBuffers.get('success');
    if (!buffer) return;

    playSound(buffer, sfxGainNode, volume * audioSettings.sfxVolume);

  } catch (error) {
    logError('Error playing success sound:', error);
  }
}

/**
 * Play combo sound with pitch variation
 */
export function playComboSound(comboLevel = 1) {
  if (!isAudioInitialized || audioSettings.muted) return;

  try {
    const buffer = audioBuffers.get('hit');
    if (!buffer) return;

    // Increase pitch based on combo level
    const pitchMultiplier = Math.min(1 + (comboLevel - 1) * 0.1, 2.0);
    const volume = Math.min(0.8 + comboLevel * 0.1, 1.0);

    playSound(buffer, sfxGainNode, volume * audioSettings.sfxVolume, pitchMultiplier);

  } catch (error) {
    logError('Error playing combo sound:', error);
  }
}

/**
 * Play background music
 */
export function playBackgroundMusic() {
  if (!isAudioInitialized || audioSettings.muted || isBackgroundMusicPlaying) return;

  try {
    const buffer = audioBuffers.get('background');
    if (!buffer) return;

    // Stop any existing background music
    stopBackgroundMusic();

    // Create and configure source
    backgroundMusic = audioContext.createBufferSource();
    backgroundMusic.buffer = buffer;
    backgroundMusic.loop = true;
    backgroundMusic.connect(musicGainNode);

    // Set up end event
    backgroundMusic.onended = () => {
      isBackgroundMusicPlaying = false;
      backgroundMusic = null;
    };

    backgroundMusic.start(0);
    isBackgroundMusicPlaying = true;

    logDev('Background music started');

  } catch (error) {
    logError('Error playing background music:', error);
  }
}

/**
 * Stop background music
 */
export function stopBackgroundMusic() {
  if (backgroundMusic && isBackgroundMusicPlaying) {
    try {
      backgroundMusic.stop();
      backgroundMusic = null;
      isBackgroundMusicPlaying = false;
      logDev('Background music stopped');
    } catch (error) {
      logError('Error stopping background music:', error);
    }
  }
}

/**
 * Generic sound playing function
 */
function playSound(buffer, gainNode, volume = 1, pitchMultiplier = 1) {
  if (!audioContext || !buffer || !gainNode) return;

  try {
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();

    source.buffer = buffer;
    source.playbackRate.value = pitchMultiplier;

    source.connect(gain);
    gain.connect(gainNode);

    // Set volume with envelope for smooth playback
    gain.gain.setValueAtTime(0, audioContext.currentTime);
    gain.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + buffer.duration);

    source.start(0);

    // Clean up after playback
    setTimeout(() => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch (e) {
        // Ignore cleanup errors
      }
    }, buffer.duration * 1000 + 100);

  } catch (error) {
    logError('Error playing sound:', error);
  }
}

/**
 * Toggle mute state
 */
export function toggleMute() {
  audioSettings.muted = !audioSettings.muted;
  
  if (audioSettings.muted) {
    // Mute all audio
    if (masterGainNode) {
      masterGainNode.gain.setValueAtTime(0, audioContext.currentTime);
    }
    stopBackgroundMusic();
    logDev('Audio muted');
  } else {
    // Unmute audio
    updateAudioVolumes();
    logDev('Audio unmuted');
  }

  saveAudioSettings();
  
  // Notify UI about mute state change
  const event = new CustomEvent('audioMuteToggled', { 
    detail: { muted: audioSettings.muted } 
  });
  document.dispatchEvent(event);
}

/**
 * Set master volume (0.0 to 1.0)
 */
export function setMasterVolume(volume) {
  audioSettings.masterVolume = Math.max(0, Math.min(1, volume));
  updateAudioVolumes();
  saveAudioSettings();
}

/**
 * Set SFX volume (0.0 to 1.0)
 */
export function setSFXVolume(volume) {
  audioSettings.sfxVolume = Math.max(0, Math.min(1, volume));
  updateAudioVolumes();
  saveAudioSettings();
}

/**
 * Set music volume (0.0 to 1.0)
 */
export function setMusicVolume(volume) {
  audioSettings.musicVolume = Math.max(0, Math.min(1, volume));
  updateAudioVolumes();
  saveAudioSettings();
}

/**
 * Update audio node volumes
 */
function updateAudioVolumes() {
  if (!audioContext || audioSettings.muted) return;

  try {
    const currentTime = audioContext.currentTime;

    if (masterGainNode) {
      masterGainNode.gain.setValueAtTime(audioSettings.masterVolume, currentTime);
    }

    if (sfxGainNode) {
      sfxGainNode.gain.setValueAtTime(audioSettings.sfxVolume, currentTime);
    }

    if (musicGainNode) {
      musicGainNode.gain.setValueAtTime(audioSettings.musicVolume, currentTime);
    }

  } catch (error) {
    logError('Error updating audio volumes:', error);
  }
}

/**
 * Get current audio settings
 */
export function getAudioSettings() {
  return { ...audioSettings };
}

/**
 * Check if audio is supported
 */
export function isAudioSupported() {
  return !!(window.AudioContext || window.webkitAudioContext);
}

/**
 * Check if audio is muted
 */
export function isMuted() {
  return audioSettings.muted;
}

/**
 * Load audio settings from storage
 */
async function loadAudioSettings() {
  try {
    const saved = await loadState(AUDIO_SETTINGS_KEY);
    if (saved && typeof saved === 'object') {
      audioSettings = { ...audioSettings, ...saved };
    }
    logDev('Audio settings loaded:', audioSettings);
  } catch (error) {
    logError('Error loading audio settings:', error);
  }
}

/**
 * Save audio settings to storage
 */
async function saveAudioSettings() {
  try {
    await saveState(AUDIO_SETTINGS_KEY, audioSettings);
    logDev('Audio settings saved');
  } catch (error) {
    logError('Error saving audio settings:', error);
  }
}

/**
 * Create audio visualizer (optional feature)
 */
export function createAudioVisualizer(canvas) {
  if (!audioContext || !canvas) return null;

  try {
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    masterGainNode.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    function draw() {
      requestAnimationFrame(draw);
      
      analyser.getByteFrequencyData(dataArray);
      
      ctx.fillStyle = 'rgb(0, 0, 0)';
      ctx.fillRect(0, 0, width, height);
      
      const barWidth = (width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;
      
      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 255 * height;
        
        ctx.fillStyle = `rgb(${barHeight + 100}, 255, ${barHeight})`;
        ctx.fillRect(x, height - barHeight, barWidth, barHeight);
        
        x += barWidth + 1;
      }
    }
    
    draw();
    return { analyser, draw };

  } catch (error) {
    logError('Error creating audio visualizer:', error);
    return null;
  }
}

/**
 * Cleanup audio resources
 */
export function cleanup() {
  try {
    stopBackgroundMusic();
    
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close();
    }
    
    audioBuffers.clear();
    audioLoadingPromises.clear();
    
    audioContext = null;
    masterGainNode = null;
    sfxGainNode = null;
    musicGainNode = null;
    isAudioInitialized = false;
    
    logDev('Audio system cleaned up');

  } catch (error) {
    logError('Error cleaning up audio:', error);
  }
}

/**
 * Handle page visibility changes
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause background music when page is hidden
    if (isBackgroundMusicPlaying) {
      stopBackgroundMusic();
    }
  } else {
    // Resume background music when page is visible (if not muted)
    if (!audioSettings.muted && isAudioInitialized) {
      setTimeout(playBackgroundMusic, 500);
    }
  }
});

// Initialize audio on module load if in browser environment
if (typeof window !== 'undefined' && isAudioSupported()) {
  // Delay initialization to allow other modules to load first
  setTimeout(initAudio, 100);
}

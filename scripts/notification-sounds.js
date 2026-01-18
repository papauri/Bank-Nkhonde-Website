/**
 * Notification Sounds Utility
 * Provides 3 different notification sounds with volume control
 */

// Sound types
const SOUND_TYPES = {
  CHIME: 'chime',
  BELL: 'bell',
  NOTIFICATION: 'notification'
};

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  type: SOUND_TYPES.CHIME,
  volume: 0.7
};

// Audio context for generating sounds
let audioContext = null;

/**
 * Initialize audio context (user interaction required)
 */
function initAudioContext() {
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (error) {
      console.error('Error initializing audio context:', error);
      return false;
    }
  }
  return true;
}

/**
 * Get notification sound settings from localStorage
 */
function getSoundSettings() {
  try {
    const settings = localStorage.getItem('notificationSoundSettings');
    if (settings) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(settings) };
    }
  } catch (error) {
    console.error('Error loading sound settings:', error);
  }
  return DEFAULT_SETTINGS;
}

/**
 * Save notification sound settings to localStorage
 */
function saveSoundSettings(settings) {
  try {
    localStorage.setItem('notificationSoundSettings', JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving sound settings:', error);
  }
}

/**
 * Generate a chime sound
 */
function generateChimeSound(volume = 0.7) {
  if (!initAudioContext()) return;
  
  const duration = 0.5;
  const sampleRate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0);
  
  // Create a pleasant chime (C-E-G chord)
  const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5
  
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    
    frequencies.forEach((freq, index) => {
      const amplitude = Math.exp(-t * 3) * (1 - index * 0.3); // Exponential decay
      sample += Math.sin(2 * Math.PI * freq * t) * amplitude;
    });
    
    // Apply envelope
    const envelope = Math.exp(-t * 4);
    data[i] = sample * envelope * volume;
  }
  
  return buffer;
}

/**
 * Generate a bell sound
 */
function generateBellSound(volume = 0.7) {
  if (!initAudioContext()) return;
  
  const duration = 0.8;
  const sampleRate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0);
  
  // Bell-like frequency with harmonics
  const fundamental = 880; // A5
  
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    
    // Add harmonics for bell-like sound
    for (let harmonic = 1; harmonic <= 5; harmonic++) {
      const freq = fundamental * harmonic;
      const amplitude = Math.exp(-t * (2 + harmonic * 0.5)) / (harmonic * 0.6);
      sample += Math.sin(2 * Math.PI * freq * t) * amplitude;
    }
    
    // Apply envelope
    const envelope = Math.exp(-t * 2);
    data[i] = sample * envelope * volume * 0.5;
  }
  
  return buffer;
}

/**
 * Generate a notification sound
 */
function generateNotificationSound(volume = 0.7) {
  if (!initAudioContext()) return;
  
  const duration = 0.3;
  const sampleRate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0);
  
  // Simple two-tone notification
  const freq1 = 800;
  const freq2 = 1000;
  
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    
    if (t < duration / 2) {
      // First tone
      sample = Math.sin(2 * Math.PI * freq1 * t);
    } else {
      // Second tone
      sample = Math.sin(2 * Math.PI * freq2 * (t - duration / 2));
    }
    
    // Apply envelope
    const envelope = Math.exp(-t * 8);
    data[i] = sample * envelope * volume;
  }
  
  return buffer;
}

/**
 * Play a notification sound based on settings
 */
function playNotificationSound() {
  const settings = getSoundSettings();
  
  // Check if sounds are enabled
  if (!settings.enabled) {
    return;
  }
  
  // Initialize audio context on first interaction
  if (!audioContext) {
    // Try to resume audio context if it's suspended
    if (audioContext?.state === 'suspended') {
      audioContext.resume();
    }
    if (!initAudioContext()) {
      console.warn('Audio context not available. User interaction may be required.');
      return;
    }
  }
  
  let buffer;
  
  // Generate sound based on type
  switch (settings.type) {
    case SOUND_TYPES.CHIME:
      buffer = generateChimeSound(settings.volume);
      break;
    case SOUND_TYPES.BELL:
      buffer = generateBellSound(settings.volume);
      break;
    case SOUND_TYPES.NOTIFICATION:
      buffer = generateNotificationSound(settings.volume);
      break;
    default:
      buffer = generateChimeSound(settings.volume);
  }
  
  if (!buffer) return;
  
  // Play the sound
  try {
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    
    gainNode.gain.value = settings.volume;
    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    source.start(0);
  } catch (error) {
    console.error('Error playing notification sound:', error);
  }
}

/**
 * Test a notification sound
 */
function testNotificationSound(type, volume = 0.7) {
  if (!initAudioContext()) return;
  
  // Resume audio context if suspended
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  let buffer;
  
  switch (type) {
    case SOUND_TYPES.CHIME:
      buffer = generateChimeSound(volume);
      break;
    case SOUND_TYPES.BELL:
      buffer = generateBellSound(volume);
      break;
    case SOUND_TYPES.NOTIFICATION:
      buffer = generateNotificationSound(volume);
      break;
    default:
      buffer = generateChimeSound(volume);
  }
  
  if (!buffer) return;
  
  try {
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    
    gainNode.gain.value = volume;
    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    source.start(0);
  } catch (error) {
    console.error('Error testing notification sound:', error);
  }
}

// Export functions
export {
  SOUND_TYPES,
  getSoundSettings,
  saveSoundSettings,
  playNotificationSound,
  testNotificationSound
};

// Make available globally
window.NotificationSounds = {
  SOUND_TYPES,
  getSoundSettings,
  saveSoundSettings,
  playNotificationSound,
  testNotificationSound
};

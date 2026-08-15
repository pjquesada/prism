/** Analysis constants for Demo Track feature extraction (Phase 1B). */

export const DEFAULT_FFT_SIZE = 2048;
export const DEFAULT_BAND_COUNT = 32;
export const MAX_FEATURE_HZ = 30;
export const FEATURE_INTERVAL_MS = 1000 / MAX_FEATURE_HZ;

/** Hz cutoffs for aggregate bands (relative to analyser frequencyBinCount). */
export const BASS_MAX_HZ = 250;
export const MID_MAX_HZ = 2000;
export const HIGH_MAX_HZ = 8000;

export const ATTACK_COEFF = 0.35;
export const RELEASE_COEFF = 0.08;
export const ONSET_THRESHOLD = 0.12;
export const ONSET_COOLDOWN_MS = 120;

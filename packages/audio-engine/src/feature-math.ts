import type { AudioFeatureFrame } from "@prism/contracts";
import { createSilentFeatureFrame } from "@prism/contracts";

import {
  ATTACK_COEFF,
  BASS_MAX_HZ,
  DEFAULT_BAND_COUNT,
  HIGH_MAX_HZ,
  MID_MAX_HZ,
  ONSET_COOLDOWN_MS,
  ONSET_THRESHOLD,
  RELEASE_COEFF,
} from "./constants.js";

export type BandEnergies = {
  bass: number;
  mid: number;
  high: number;
  bands: number[];
};

export type EnvelopeState = {
  energy: number;
  bands: number[];
  bass: number;
  mid: number;
  high: number;
};

export type BeatState = {
  lastOnsetMs: number;
  intervalsMs: number[];
  beatPhase: number;
  bpmEstimate: number | null;
  phaseAnchorMs: number;
};

export function createEnvelopeState(bandCount = DEFAULT_BAND_COUNT): EnvelopeState {
  return {
    energy: 0,
    bands: Array.from({ length: bandCount }, () => 0),
    bass: 0,
    mid: 0,
    high: 0,
  };
}

export function createBeatState(): BeatState {
  return {
    lastOnsetMs: -Infinity,
    intervalsMs: [],
    beatPhase: 0,
    bpmEstimate: null,
    phaseAnchorMs: 0,
  };
}

export function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Smooth toward target with asymmetric attack/release. */
export function smoothToward(
  current: number,
  target: number,
  attack = ATTACK_COEFF,
  release = RELEASE_COEFF,
): number {
  const coeff = target > current ? attack : release;
  return current + (target - current) * coeff;
}

export function computeRms(timeDomain: ArrayLike<number>): number {
  if (timeDomain.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < timeDomain.length; i += 1) {
    const centered = ((timeDomain[i] ?? 128) - 128) / 128;
    sum += centered * centered;
  }
  return clamp01(Math.sqrt(sum / timeDomain.length) * 2);
}

export function computePeak(timeDomain: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < timeDomain.length; i += 1) {
    const centered = Math.abs(((timeDomain[i] ?? 128) - 128) / 128);
    if (centered > peak) peak = centered;
  }
  return clamp01(peak);
}

export function hzToBin(hz: number, sampleRate: number, fftSize: number): number {
  const bin = Math.floor((hz / sampleRate) * fftSize);
  return Math.max(0, Math.min(fftSize / 2 - 1, bin));
}

/**
 * Map analyser frequency data into normalized spectrum buckets plus bass/mid/high aggregates.
 * `frequencyData` is expected as 0–255 byte values from AnalyserNode.
 */
export function extractBandEnergies(
  frequencyData: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  bandCount = DEFAULT_BAND_COUNT,
): BandEnergies {
  const binCount = frequencyData.length;
  const bands = Array.from({ length: bandCount }, () => 0);
  if (binCount === 0) {
    return { bass: 0, mid: 0, high: 0, bands };
  }

  const usableBins = Math.max(1, Math.floor(binCount * 0.85));
  const binsPerBand = usableBins / bandCount;

  for (let band = 0; band < bandCount; band += 1) {
    const start = Math.floor(band * binsPerBand);
    const end = Math.floor((band + 1) * binsPerBand);
    let sum = 0;
    let count = 0;
    for (let i = start; i < end && i < binCount; i += 1) {
      sum += frequencyData[i] ?? 0;
      count += 1;
    }
    bands[band] = clamp01(count > 0 ? sum / (count * 255) : 0);
  }

  const bassEnd = Math.min(binCount, hzToBin(BASS_MAX_HZ, sampleRate, fftSize) + 1);
  const midEnd = Math.min(binCount, hzToBin(MID_MAX_HZ, sampleRate, fftSize) + 1);
  const highEnd = Math.min(binCount, hzToBin(HIGH_MAX_HZ, sampleRate, fftSize) + 1);

  const averageRange = (start: number, end: number): number => {
    if (end <= start) return 0;
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += frequencyData[i] ?? 0;
    return clamp01(sum / ((end - start) * 255));
  };

  return {
    bass: averageRange(1, bassEnd),
    mid: averageRange(bassEnd, midEnd),
    high: averageRange(midEnd, highEnd),
    bands,
  };
}

export function applyEnvelope(
  state: EnvelopeState,
  next: BandEnergies,
  rawEnergy: number,
): EnvelopeState {
  const bands = state.bands.map((current, i) => smoothToward(current, next.bands[i] ?? 0));
  return {
    energy: smoothToward(state.energy, rawEnergy),
    bands,
    bass: smoothToward(state.bass, next.bass),
    mid: smoothToward(state.mid, next.mid),
    high: smoothToward(state.high, next.high),
  };
}

export function detectOnset(
  beat: BeatState,
  previousEnergy: number,
  currentEnergy: number,
  timestampMs: number,
): { onset: boolean; beat: BeatState } {
  const delta = currentEnergy - previousEnergy;
  const cooled = timestampMs - beat.lastOnsetMs >= ONSET_COOLDOWN_MS;
  const onset = cooled && delta >= ONSET_THRESHOLD && currentEnergy > 0.08;

  if (!onset) {
    const elapsed = timestampMs - beat.phaseAnchorMs;
    const period = beat.bpmEstimate ? 60_000 / beat.bpmEstimate : 600;
    const beatPhase = clamp01((elapsed % period) / period);
    return { onset: false, beat: { ...beat, beatPhase } };
  }

  const intervalsMs = [...beat.intervalsMs];
  if (Number.isFinite(beat.lastOnsetMs) && beat.lastOnsetMs > 0) {
    const interval = timestampMs - beat.lastOnsetMs;
    if (interval > 250 && interval < 2000) {
      intervalsMs.push(interval);
      if (intervalsMs.length > 8) intervalsMs.shift();
    }
  }

  let bpmEstimate = beat.bpmEstimate;
  if (intervalsMs.length >= 2) {
    const avg = intervalsMs.reduce((a, b) => a + b, 0) / intervalsMs.length;
    const nextBpm = Math.round(60_000 / avg);
    bpmEstimate = nextBpm >= 40 && nextBpm <= 220 ? nextBpm : null;
  }

  return {
    onset: true,
    beat: {
      lastOnsetMs: timestampMs,
      intervalsMs,
      beatPhase: 0,
      bpmEstimate,
      phaseAnchorMs: timestampMs,
    },
  };
}

export type FeatureExtractorState = {
  envelope: EnvelopeState;
  beat: BeatState;
  previousEnergy: number;
};

export function createFeatureExtractorState(bandCount = DEFAULT_BAND_COUNT): FeatureExtractorState {
  return {
    envelope: createEnvelopeState(bandCount),
    beat: createBeatState(),
    previousEnergy: 0,
  };
}

export function buildFeatureFrame(
  state: FeatureExtractorState,
  input: {
    timeDomain: ArrayLike<number>;
    frequencyData: ArrayLike<number>;
    sampleRate: number;
    fftSize: number;
    timestampMs: number;
    bandCount?: number;
  },
): { frame: AudioFeatureFrame; state: FeatureExtractorState } {
  const bandCount = input.bandCount ?? DEFAULT_BAND_COUNT;
  const rms = computeRms(input.timeDomain);
  const peak = computePeak(input.timeDomain);
  const bands = extractBandEnergies(
    input.frequencyData,
    input.sampleRate,
    input.fftSize,
    bandCount,
  );
  const rawEnergy = clamp01(rms * 0.55 + bands.bass * 0.25 + bands.mid * 0.15 + bands.high * 0.05);
  const envelope = applyEnvelope(state.envelope, bands, rawEnergy);
  const { onset, beat } = detectOnset(
    state.beat,
    state.previousEnergy,
    envelope.energy,
    input.timestampMs,
  );

  const frame: AudioFeatureFrame = {
    timestampMs: input.timestampMs,
    rms,
    peak,
    bpmEstimate: beat.bpmEstimate,
    beatPhase: beat.beatPhase,
    bands: envelope.bands,
    energy: envelope.energy,
    onset,
  };

  return {
    frame,
    state: {
      envelope,
      beat,
      previousEnergy: envelope.energy,
    },
  };
}

export function silentFrame(timestampMs = 0, bandCount = DEFAULT_BAND_COUNT): AudioFeatureFrame {
  return createSilentFeatureFrame(timestampMs, bandCount);
}

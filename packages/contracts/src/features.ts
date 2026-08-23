import { z } from "zod";

import { createSilentFeatureFrame, type AudioFeatureFrame } from "./domain.js";

/** Compact Capture Music / Demo Track envelope — never includes FFT bins, PCM, or MediaStream data. */
export const AUDIO_FEATURE_ENVELOPE_LEVEL_COUNT = 8;
/** Target publish rate for controller → display envelopes (15–30 Hz). */
export const AUDIO_FEATURE_ENVELOPE_MAX_HZ = 20;
export const AUDIO_FEATURE_ENVELOPE_INTERVAL_MS = 1000 / AUDIO_FEATURE_ENVELOPE_MAX_HZ;
export const AUDIO_FEATURE_ENVELOPE_MAX_BYTES = 768;
export const AUDIO_FEATURE_ENVELOPE_STALE_MS = 1_500;
/** Begin decaying toward silence if no envelope arrives. */
export const AUDIO_FEATURE_ENVELOPE_DECAY_START_MS = 180;
/** Reach silence after this much gap. */
export const AUDIO_FEATURE_ENVELOPE_SILENCE_MS = 700;

const unit = z.number().min(0).max(1);

export const audioFeatureEnvelopeSchema = z
  .object({
    frameSeq: z.number().int().nonnegative(),
    timestampMs: z.number().nonnegative(),
    rms: unit,
    energy: unit,
    bass: unit,
    mid: unit,
    high: unit,
    levels: z.array(unit).length(AUDIO_FEATURE_ENVELOPE_LEVEL_COUNT),
    onset: z.boolean(),
    beatStrength: unit,
    centroid: unit,
  })
  .strict();

export type AudioFeatureEnvelope = z.infer<typeof audioFeatureEnvelopeSchema>;

export function createSilentFeatureEnvelope(frameSeq = 0, timestampMs = 0): AudioFeatureEnvelope {
  return {
    frameSeq,
    timestampMs,
    rms: 0,
    energy: 0,
    bass: 0,
    mid: 0,
    high: 0,
    levels: Array.from({ length: AUDIO_FEATURE_ENVELOPE_LEVEL_COUNT }, () => 0),
    onset: false,
    beatStrength: 0,
    centroid: 0,
  };
}

function downsampleLevels(bands: number[], count: number): number[] {
  if (count <= 0) return [];
  if (bands.length === 0) return Array.from({ length: count }, () => 0);
  const levels = Array.from({ length: count }, () => 0);
  const stride = bands.length / count;
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(i * stride);
    const end = Math.max(start + 1, Math.floor((i + 1) * stride));
    let sum = 0;
    let n = 0;
    for (let b = start; b < end && b < bands.length; b += 1) {
      sum += bands[b] ?? 0;
      n += 1;
    }
    levels[i] = n > 0 ? sum / n : 0;
  }
  return levels;
}

function upsampleLevels(levels: number[], bandCount: number): number[] {
  if (bandCount <= 0) return [];
  if (levels.length === 0) return Array.from({ length: bandCount }, () => 0);
  const bands = Array.from({ length: bandCount }, () => 0);
  const stride = bandCount / levels.length;
  for (let i = 0; i < levels.length; i += 1) {
    const start = Math.floor(i * stride);
    const end = Math.max(start + 1, Math.floor((i + 1) * stride));
    const value = levels[i] ?? 0;
    for (let b = start; b < end && b < bandCount; b += 1) {
      bands[b] = value;
    }
  }
  return bands;
}

function centroidFromLevels(levels: number[]): number {
  let weighted = 0;
  let sum = 0;
  for (let i = 0; i < levels.length; i += 1) {
    const value = levels[i] ?? 0;
    weighted += i * value;
    sum += value;
  }
  if (sum <= 0 || levels.length <= 1) return 0;
  return Math.min(1, Math.max(0, weighted / (sum * (levels.length - 1))));
}

/** Map a local analysis frame to the compact wire envelope. Drops FFT/`bands`. */
export function audioFeatureFrameToEnvelope(
  frame: AudioFeatureFrame,
  frameSeq: number,
  timestampMs: number,
): AudioFeatureEnvelope {
  const levels = downsampleLevels(frame.bands, AUDIO_FEATURE_ENVELOPE_LEVEL_COUNT);
  const beatStrength = frame.onset ? Math.min(1, Math.max(frame.energy, 0.35)) : 0;
  return audioFeatureEnvelopeSchema.parse({
    frameSeq,
    timestampMs,
    rms: frame.rms,
    energy: frame.energy,
    bass: frame.bass,
    mid: frame.mid,
    high: frame.high,
    levels,
    onset: frame.onset,
    beatStrength,
    centroid: centroidFromLevels(levels),
  });
}

/** Expand a compact envelope into a local visualizer feature frame. */
export function audioFeatureEnvelopeToFrame(
  envelope: AudioFeatureEnvelope,
  bandCount = 32,
): AudioFeatureFrame {
  const parsed = audioFeatureEnvelopeSchema.parse(envelope);
  return {
    ...createSilentFeatureFrame(parsed.timestampMs, bandCount),
    timestampMs: parsed.timestampMs,
    rms: parsed.rms,
    peak: Math.max(parsed.rms, parsed.energy),
    energy: parsed.energy,
    bass: parsed.bass,
    mid: parsed.mid,
    high: parsed.high,
    onset: parsed.onset,
    beatPhase: parsed.beatStrength,
    bands: upsampleLevels(parsed.levels, bandCount),
  };
}

import { describe, expect, it } from "vitest";

import { audioFeatureFrameSchema } from "@prism/contracts";

import {
  buildFeatureFrame,
  computePeak,
  computeRms,
  createFeatureExtractorState,
  detectOnset,
  extractBandEnergies,
  silentFrame,
  smoothToward,
} from "./feature-math.js";

function fillByteNoise(length: number, amplitude: number): Uint8Array {
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.round(128 + Math.sin(i / 3) * amplitude);
  }
  return data;
}

describe("feature math", () => {
  it("computes rms and peak in 0..1 from time-domain bytes", () => {
    const quiet = new Uint8Array(64).fill(128);
    expect(computeRms(quiet)).toBe(0);
    expect(computePeak(quiet)).toBe(0);

    const loud = fillByteNoise(64, 100);
    expect(computeRms(loud)).toBeGreaterThan(0.3);
    expect(computePeak(loud)).toBeGreaterThan(0.5);
  });

  it("maps frequency bins into bands plus bass/mid/high", () => {
    const frequency = new Uint8Array(1024);
    for (let i = 0; i < 20; i += 1) frequency[i] = 200;
    for (let i = 40; i < 80; i += 1) frequency[i] = 180;
    for (let i = 200; i < 260; i += 1) frequency[i] = 160;

    const bands = extractBandEnergies(frequency, 44100, 2048, 32);
    expect(bands.bands).toHaveLength(32);
    expect(bands.bass).toBeGreaterThan(0);
    expect(bands.mid).toBeGreaterThan(0);
    expect(bands.high).toBeGreaterThanOrEqual(0);
    expect(Math.max(...bands.bands)).toBeLessThanOrEqual(1);
  });

  it("applies attack/release smoothing asymmetrically", () => {
    expect(smoothToward(0, 1)).toBeGreaterThan(0.3);
    expect(smoothToward(1, 0)).toBeGreaterThan(0.8);
  });

  it("detects onsets with cooldown and updates beat phase", () => {
    const first = detectOnset(
      {
        lastOnsetMs: -Infinity,
        intervalsMs: [],
        beatPhase: 0,
        bpmEstimate: null,
        phaseAnchorMs: 0,
      },
      0.05,
      0.4,
      1000,
    );
    expect(first.onset).toBe(true);

    const cooled = detectOnset(first.beat, 0.4, 0.7, 1050);
    expect(cooled.onset).toBe(false);

    const next = detectOnset(first.beat, 0.2, 0.5, 1600);
    expect(next.onset).toBe(true);
  });

  it("builds schema-valid feature frames from fixtures", () => {
    const state = createFeatureExtractorState(16);
    const { frame } = buildFeatureFrame(state, {
      timeDomain: fillByteNoise(512, 40),
      frequencyData: fillByteNoise(1024, 80),
      sampleRate: 44100,
      fftSize: 2048,
      timestampMs: 2500,
      bandCount: 16,
    });
    const parsed = audioFeatureFrameSchema.parse(frame);
    expect(parsed.bands).toHaveLength(16);
    expect(parsed.bass).toBeGreaterThanOrEqual(0);
    expect(parsed.mid).toBeGreaterThanOrEqual(0);
    expect(parsed.high).toBeGreaterThanOrEqual(0);
  });

  it("returns silent frames for fallbacks", () => {
    const frame = silentFrame(12, 8);
    expect(frame.energy).toBe(0);
    expect(frame.bands).toHaveLength(8);
    expect(frame.bass).toBe(0);
    expect(frame.mid).toBe(0);
    expect(frame.high).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  AUDIO_FEATURE_ENVELOPE_LEVEL_COUNT,
  audioFeatureEnvelopeSchema,
  audioFeatureEnvelopeToFrame,
  audioFeatureFrameToEnvelope,
  createSilentFeatureFrame,
  sessionMessageSchema,
} from "./index.js";

describe("compact audio feature envelopes", () => {
  it("maps local frames to a small numeric envelope without FFT/PCM keys", () => {
    const frame = {
      ...createSilentFeatureFrame(10, 32),
      energy: 0.4,
      rms: 0.3,
      bass: 0.5,
      mid: 0.2,
      high: 0.1,
      onset: true,
      bands: Array.from({ length: 32 }, (_, i) => (i % 8) / 8),
    };
    const envelope = audioFeatureFrameToEnvelope(frame, 3, Date.now());
    expect(envelope.levels).toHaveLength(AUDIO_FEATURE_ENVELOPE_LEVEL_COUNT);
    expect(envelope.frameSeq).toBe(3);
    const json = JSON.stringify(envelope);
    expect(json).not.toMatch(/"bands"/);
    expect(json).not.toMatch(/pcm|microphone|fft|MediaStream|frequencyData/);
    expect(audioFeatureEnvelopeSchema.parse(envelope).energy).toBeCloseTo(0.4);
    const restored = audioFeatureEnvelopeToFrame(envelope, 32);
    expect(restored.bands).toHaveLength(32);
    expect(restored.energy).toBeCloseTo(0.4);
  });

  it("rejects invalid envelopes", () => {
    expect(() =>
      audioFeatureEnvelopeSchema.parse({
        frameSeq: 1,
        timestampMs: 1,
        rms: 0,
        energy: 2,
        bass: 0,
        mid: 0,
        high: 0,
        levels: [0, 0, 0, 0, 0, 0, 0, 0],
        onset: false,
        beatStrength: 0,
        centroid: 0,
      }),
    ).toThrow();
    expect(() =>
      audioFeatureEnvelopeSchema.parse({
        frameSeq: 1,
        timestampMs: 1,
        rms: 0,
        energy: 0,
        bass: 0,
        mid: 0,
        high: 0,
        levels: [0, 0, 0],
        onset: false,
        beatStrength: 0,
        centroid: 0,
      }),
    ).toThrow();
    expect(() =>
      audioFeatureEnvelopeSchema.parse({
        frameSeq: 1,
        timestampMs: 1,
        rms: 0,
        energy: 0,
        bass: 0,
        mid: 0,
        high: 0,
        levels: [0, 0, 0, 0, 0, 0, 0, 0],
        onset: false,
        beatStrength: 0,
        centroid: 0,
        bands: [1, 2, 3],
      }),
    ).toThrow();
  });

  it("accepts an audio.features session message", () => {
    const msg = sessionMessageSchema.parse({
      type: "audio.features",
      seq: 0,
      sentAt: new Date().toISOString(),
      sessionId: "11111111-1111-4111-8111-111111111111",
      deviceId: "controller-1",
      payload: audioFeatureFrameToEnvelope(createSilentFeatureFrame(), 1, Date.now()),
    });
    expect(msg.type).toBe("audio.features");
    expect(JSON.stringify(msg)).not.toMatch(/"bands"|pcm|fft|microphone/);
  });
});

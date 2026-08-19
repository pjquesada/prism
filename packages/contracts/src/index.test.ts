import { describe, expect, it } from "vitest";

import {
  audioFeatureFrameSchema,
  audioModeSchema,
  createBuiltInPresets,
  createSilentFeatureFrame,
  createUserPreset,
  deviceRoleSchema,
  mergeActivePresetSnapshot,
  parseVisualizerParams,
  presetConfigSchema,
  qualityTierSchema,
  spectrumParamsDefaults,
  spectrumParamsSchema,
  visualizerIdSchema,
} from "./index.js";

describe("contracts schemas", () => {
  it("parses device roles", () => {
    expect(deviceRoleSchema.parse("combined")).toBe("combined");
    expect(() => deviceRoleSchema.parse("host")).toThrow();
  });

  it("parses audio modes and visualizer ids", () => {
    expect(audioModeSchema.parse("demo_track")).toBe("demo_track");
    expect(audioModeSchema.parse("live_listen")).toBe("live_listen");
    expect(visualizerIdSchema.parse("spectrum")).toBe("spectrum");
    expect(visualizerIdSchema.parse("particles")).toBe("particles");
    expect(visualizerIdSchema.parse("album_world")).toBe("album_world");
    expect(qualityTierSchema.parse("high")).toBe("high");
  });

  it("validates silent feature frames with bass/mid/high", () => {
    const frame = createSilentFeatureFrame(12, 8);
    expect(audioFeatureFrameSchema.parse(frame).bands).toHaveLength(8);
    expect(frame.onset).toBe(false);
    expect(frame.bass).toBe(0);
    expect(frame.mid).toBe(0);
    expect(frame.high).toBe(0);
  });

  it("provides spectrum param defaults", () => {
    expect(spectrumParamsSchema.parse({}).barCount).toBe(32);
    expect(spectrumParamsDefaults.sensitivity).toBe(1);
  });

  it("ships immutable built-in presets and validates user presets", () => {
    const builtins = createBuiltInPresets();
    expect(builtins.length).toBeGreaterThanOrEqual(3);
    expect(builtins.every((p) => p.isBuiltIn)).toBe(true);
    expect(() => {
      (builtins[0] as { name: string }).name = "mutated";
    }).toThrow();

    const user = createUserPreset({
      name: "My Spectrum",
      visualizerId: "spectrum",
      params: { sensitivity: 1.5 },
    });
    expect(presetConfigSchema.parse(user).isBuiltIn).toBe(false);
    expect(parseVisualizerParams("particles", { particleCount: 512 }).particleCount).toBe(512);
  });

  it("canonicalizes visualizer patches with validated params", () => {
    const now = "2026-08-19T00:00:00.000Z";
    const current = {
      visualizerId: "spectrum" as const,
      qualityTier: "high" as const,
      presetId: "builtin-spectrum-calm",
      params: { ...spectrumParamsDefaults },
      updatedAt: now,
      seq: 1,
    };
    const particles = mergeActivePresetSnapshot(current, { visualizerId: "particles" }, 2, now);
    expect(particles.visualizerId).toBe("particles");
    expect(particles.presetId).toBeNull();
    expect(particles.seq).toBe(2);
    expect(particles.params.particleCount).toBeDefined();

    const withPreset = mergeActivePresetSnapshot(
      particles,
      {
        visualizerId: "album_world",
        presetId: "builtin-album-world-drift",
        params: { parallaxStrength: 1.1 },
      },
      3,
      now,
    );
    expect(withPreset.visualizerId).toBe("album_world");
    expect(withPreset.presetId).toBe("builtin-album-world-drift");
    expect(withPreset.params.parallaxStrength).toBe(1.1);
  });
});

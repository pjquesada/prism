import { describe, expect, it } from "vitest";

import {
  audioFeatureFrameSchema,
  audioModeSchema,
  createBuiltInPresets,
  createSilentFeatureFrame,
  createUserPreset,
  deviceRoleSchema,
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
});

import { describe, expect, it } from "vitest";

import {
  audioFeatureFrameSchema,
  audioModeSchema,
  createSilentFeatureFrame,
  deviceRoleSchema,
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
    expect(qualityTierSchema.parse("high")).toBe("high");
  });

  it("validates silent feature frames", () => {
    const frame = createSilentFeatureFrame(12, 8);
    expect(audioFeatureFrameSchema.parse(frame).bands).toHaveLength(8);
    expect(frame.onset).toBe(false);
  });

  it("provides spectrum param defaults", () => {
    expect(spectrumParamsSchema.parse({}).barCount).toBe(32);
    expect(spectrumParamsDefaults.sensitivity).toBe(1);
  });
});

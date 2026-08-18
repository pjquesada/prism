import { describe, expect, it } from "vitest";
import { requireVisualizerPlugin } from "@prism/visualizers";
import { AdaptiveQualityManager, qualityCaps } from "@prism/visual-engine";

describe("Phase 1C visualizers remain available after the session hotfix", () => {
  it("loads Spectrum, Particles, and Album World plugins", () => {
    expect(requireVisualizerPlugin("spectrum").id).toBe("spectrum");
    expect(requireVisualizerPlugin("particles").id).toBe("particles");
    expect(requireVisualizerPlugin("album_world").id).toBe("album_world");
  });

  it("keeps adaptive quality caps ordered by cost", () => {
    const manager = new AdaptiveQualityManager({ initialTier: "high" });
    expect(manager.getEffectiveTier()).toBe("high");
    expect(qualityCaps("low").particleCount).toBeLessThan(qualityCaps("high").particleCount);
  });
});

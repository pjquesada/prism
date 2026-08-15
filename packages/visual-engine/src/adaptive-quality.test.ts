import type { QualityTier } from "@prism/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdaptiveQualityManager, QUALITY_CAPS, clampDpr, qualityCaps } from "./adaptive-quality.js";

describe("adaptive quality", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes increasing particle and dpr caps by tier", () => {
    expect(qualityCaps("low").particleCount).toBeLessThan(qualityCaps("ultra").particleCount);
    expect(QUALITY_CAPS.low.dprCap).toBeLessThan(QUALITY_CAPS.high.dprCap);
    expect(clampDpr(3, "medium")).toBe(QUALITY_CAPS.medium.dprCap);
  });

  it("downgrades after sustained poor frames and upgrades conservatively", () => {
    const manager = new AdaptiveQualityManager({
      initialTier: "high",
      downgradeAfter: 3,
      upgradeAfter: 5,
      cooldownMs: 0,
    });

    expect(manager.getEffectiveTier()).toBe("high");
    for (let i = 0; i < 3; i += 1) {
      manager.sampleFrame(40, i * 10);
    }
    expect(manager.getEffectiveTier()).toBe("medium");

    for (let i = 0; i < 5; i += 1) {
      manager.sampleFrame(8, 1000 + i * 10);
    }
    expect(manager.getEffectiveTier()).toBe("high");
  });

  it("ignores auto stepping while a manual tier is set", () => {
    const manager = new AdaptiveQualityManager({
      initialTier: "high",
      downgradeAfter: 1,
      cooldownMs: 0,
    });
    manager.setManualTier("ultra");
    manager.sampleFrame(100, 10);
    expect(manager.getEffectiveTier()).toBe("ultra");
    manager.setManualTier(null);
    manager.setAutoTier("low" satisfies QualityTier);
    expect(manager.getEffectiveTier()).toBe("low");
  });
});

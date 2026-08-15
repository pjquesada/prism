import type { QualityTier } from "@prism/contracts";

export type AdaptiveQualityCaps = {
  dprCap: number;
  resolutionScale: number;
  targetFps: number;
  particleCount: number;
  maxFrameMs: number;
};

export type AdaptiveQualityOptions = {
  /** Manual override; when set, auto stepping is suspended until cleared. */
  manualTier?: QualityTier | null;
  initialTier?: QualityTier;
  /** Consecutive over-budget samples before stepping down. */
  downgradeAfter?: number;
  /** Consecutive under-budget samples before stepping up. */
  upgradeAfter?: number;
  /** Minimum ms between automatic tier changes. */
  cooldownMs?: number;
};

const TIER_ORDER: QualityTier[] = ["low", "medium", "high", "ultra"];

export const QUALITY_CAPS: Record<QualityTier, AdaptiveQualityCaps> = {
  low: {
    dprCap: 1,
    resolutionScale: 0.7,
    targetFps: 30,
    particleCount: 256,
    maxFrameMs: 1000 / 28,
  },
  medium: {
    dprCap: 1.25,
    resolutionScale: 0.85,
    targetFps: 30,
    particleCount: 640,
    maxFrameMs: 1000 / 28,
  },
  high: {
    dprCap: 1.5,
    resolutionScale: 1,
    targetFps: 60,
    particleCount: 1280,
    maxFrameMs: 1000 / 55,
  },
  ultra: {
    dprCap: 2,
    resolutionScale: 1,
    targetFps: 60,
    particleCount: 2048,
    maxFrameMs: 1000 / 55,
  },
};

export function qualityCaps(tier: QualityTier): AdaptiveQualityCaps {
  return QUALITY_CAPS[tier];
}

export function clampDpr(devicePixelRatio: number, tier: QualityTier): number {
  const cap = QUALITY_CAPS[tier].dprCap;
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, cap);
}

function tierIndex(tier: QualityTier): number {
  return TIER_ORDER.indexOf(tier);
}

function stepTier(tier: QualityTier, delta: -1 | 1): QualityTier {
  const next = Math.max(0, Math.min(TIER_ORDER.length - 1, tierIndex(tier) + delta));
  return TIER_ORDER[next] ?? tier;
}

/**
 * Tracks frame timings and recommends quality tiers with hysteresis.
 * Pure timing logic — apply DPR/resolution in the canvas host.
 */
export class AdaptiveQualityManager {
  private autoTier: QualityTier;
  private manualTier: QualityTier | null;
  private badStreak = 0;
  private goodStreak = 0;
  private lastChangeMs = 0;
  private readonly downgradeAfter: number;
  private readonly upgradeAfter: number;
  private readonly cooldownMs: number;

  constructor(options: AdaptiveQualityOptions = {}) {
    this.autoTier = options.initialTier ?? "high";
    this.manualTier = options.manualTier ?? null;
    this.downgradeAfter = options.downgradeAfter ?? 45;
    this.upgradeAfter = options.upgradeAfter ?? 180;
    this.cooldownMs = options.cooldownMs ?? 2500;
  }

  getEffectiveTier(): QualityTier {
    return this.manualTier ?? this.autoTier;
  }

  getCaps(): AdaptiveQualityCaps {
    return qualityCaps(this.getEffectiveTier());
  }

  setManualTier(tier: QualityTier | null): void {
    this.manualTier = tier;
    this.badStreak = 0;
    this.goodStreak = 0;
  }

  /** Align the automatic baseline (e.g. when the user picks a starting tier). */
  setAutoTier(tier: QualityTier): void {
    this.autoTier = tier;
    this.badStreak = 0;
    this.goodStreak = 0;
  }

  /**
   * Ingest one frame duration sample (ms). Returns true when effective tier changed.
   */
  sampleFrame(
    frameMs: number,
    nowMs = typeof performance !== "undefined" ? performance.now() : 0,
  ): boolean {
    if (this.manualTier !== null) return false;
    if (!Number.isFinite(frameMs) || frameMs <= 0) return false;

    const caps = QUALITY_CAPS[this.autoTier];
    const overBudget = frameMs > caps.maxFrameMs * 1.15;
    const comfortablyUnder = frameMs < caps.maxFrameMs * 0.65;

    if (overBudget) {
      this.badStreak += 1;
      this.goodStreak = 0;
    } else if (comfortablyUnder) {
      this.goodStreak += 1;
      this.badStreak = 0;
    } else {
      this.badStreak = Math.max(0, this.badStreak - 1);
      this.goodStreak = Math.max(0, this.goodStreak - 1);
    }

    if (nowMs - this.lastChangeMs < this.cooldownMs) return false;

    if (this.badStreak >= this.downgradeAfter && this.autoTier !== "low") {
      this.autoTier = stepTier(this.autoTier, -1);
      this.badStreak = 0;
      this.goodStreak = 0;
      this.lastChangeMs = nowMs;
      return true;
    }

    if (this.goodStreak >= this.upgradeAfter && this.autoTier !== "ultra") {
      this.autoTier = stepTier(this.autoTier, 1);
      this.badStreak = 0;
      this.goodStreak = 0;
      this.lastChangeMs = nowMs;
      return true;
    }

    return false;
  }

  /** Test helper / diagnostics. */
  getAutoTier(): QualityTier {
    return this.autoTier;
  }
}

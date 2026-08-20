import { describe, expect, it } from "vitest";

import { AUDIO_FEATURE_ENVELOPE_MAX_HZ, createSilentFeatureEnvelope } from "@prism/contracts";

import { RemoteFeatureInterpolator } from "./remote-features.js";

describe("RemoteFeatureInterpolator", () => {
  it("accepts compact envelopes and rejects out-of-order / stale frames", () => {
    const interp = new RemoteFeatureInterpolator();
    const now = 1_000_000;
    const first = interp.ingest(
      { ...createSilentFeatureEnvelope(1, now), energy: 0.8, rms: 0.7 },
      now,
    );
    expect(first.ok).toBe(true);
    const outOfOrder = interp.ingest(
      { ...createSilentFeatureEnvelope(1, now + 10), energy: 0.9 },
      now + 10,
    );
    expect(outOfOrder.ok).toBe(false);
    if (!outOfOrder.ok) expect(outOfOrder.reason).toBe("out_of_order");
    const stale = interp.ingest(
      { ...createSilentFeatureEnvelope(2, now - 5_000), energy: 0.9 },
      now + 20,
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("stale");
    const sampled = interp.sample(now + 16);
    expect(sampled.energy).toBeGreaterThan(0.2);
  });

  it("produces smooth intermediate frames between envelopes", () => {
    const interp = new RemoteFeatureInterpolator();
    const now = 3_000_000;
    interp.ingest({ ...createSilentFeatureEnvelope(1, now), energy: 1, rms: 1, bass: 1 }, now);
    const a = interp.sample(now + 8);
    const b = interp.sample(now + 24);
    const c = interp.sample(now + 48);
    expect(a.energy).toBeGreaterThan(0);
    expect(a.energy).toBeLessThan(1);
    expect(b.energy).toBeGreaterThan(a.energy);
    expect(c.energy).toBeGreaterThan(b.energy);
    expect(c.energy).toBeLessThanOrEqual(1);
  });

  it("decays toward silence when frames stop", () => {
    const interp = new RemoteFeatureInterpolator();
    const now = 2_000_000;
    interp.ingest({ ...createSilentFeatureEnvelope(1, now), energy: 1, rms: 1, bass: 1 }, now);
    interp.sample(now + 16);
    interp.sample(now + 32);
    const live = interp.sample(now + 48);
    expect(live.energy).toBeGreaterThan(0.4);
    const decayed = interp.sample(now + 900);
    expect(decayed.energy).toBeLessThan(0.05);
    expect(decayed.energy).toBeLessThan(live.energy);
  });

  it("rejects oversized payloads", () => {
    const interp = new RemoteFeatureInterpolator();
    const result = interp.ingest(createSilentFeatureEnvelope(1, Date.now()), Date.now(), 8_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("oversized");
  });

  it("samples faster than the 20 Hz network cap", () => {
    const interp = new RemoteFeatureInterpolator();
    const now = 4_000_000;
    let ingested = 0;
    for (let t = 0; t <= 1000; t += 50) {
      interp.ingest(
        { ...createSilentFeatureEnvelope(ingested + 1, now + t), energy: 0.7, rms: 0.6 },
        now + t,
      );
      ingested += 1;
    }
    let samples = 0;
    for (let t = 0; t <= 1000; t += 16) {
      interp.sample(now + t);
      samples += 1;
    }
    expect(ingested).toBeLessThanOrEqual(AUDIO_FEATURE_ENVELOPE_MAX_HZ + 1);
    expect(samples).toBeGreaterThan(AUDIO_FEATURE_ENVELOPE_MAX_HZ);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import {
  createGuestSession,
  getLatestFeatureReceiptMemory,
  getSessionFeaturesAfterMemory,
  joinWithPairingCode,
  publishSessionFeaturesMemory,
  recordFeatureReceiptMemory,
  resetSessionStoreForTests,
} from "./memory-store";
import { publishSessionFeatures } from "./feature-transport";

function sampleEnvelope(frameSeq: number, timestampMs = Date.now()) {
  return {
    frameSeq,
    timestampMs,
    rms: 0.2,
    energy: 0.4,
    bass: 0.3,
    mid: 0.2,
    high: 0.1,
    levels: [0.1, 0.2, 0.3, 0.2, 0.1, 0.1, 0.05, 0.02],
    onset: true,
    beatStrength: 0.5,
    centroid: 0.4,
  };
}

describe("feature transport memory backend", () => {
  afterEach(() => {
    resetSessionStoreForTests();
    process.env.PRISM_SESSION_BACKEND = "memory";
  });

  it("accepts controller publication with durable storage", async () => {
    const created = createGuestSession({ role: "controller" });
    const result = await publishSessionFeatures(created.credential.token, sampleEnvelope(1));
    expect(result.accepted).toBe(true);
    expect(result.durableFallback).toBe("stored");
    expect(result.frameSeq).toBe(1);
  });

  it("rejects display publication", async () => {
    const created = createGuestSession({ role: "controller" });
    const joined = joinWithPairingCode({ code: created.pairingCode, role: "display" });
    await expect(
      publishSessionFeatures(joined.credential.token, sampleEnvelope(1)),
    ).rejects.toThrow(/Displays cannot publish/);
  });

  it("returns newer fallback frames and 204 semantics via service", async () => {
    const created = createGuestSession({ role: "controller" });
    await publishSessionFeatures(created.credential.token, sampleEnvelope(4));
    const joined = joinWithPairingCode({ code: created.pairingCode, role: "display" });
    expect(getSessionFeaturesAfterMemory(joined.credential.token, 3)?.frameSeq).toBe(4);
    expect(getSessionFeaturesAfterMemory(joined.credential.token, 4)).toBeNull();
  });

  it("rejects cross-session reads implicitly via credential scope", async () => {
    const a = createGuestSession({ role: "controller" });
    const b = createGuestSession({ role: "controller" });
    await publishSessionFeatures(a.credential.token, sampleEnvelope(2));
    const joinedB = joinWithPairingCode({ code: b.pairingCode, role: "display" });
    expect(getSessionFeaturesAfterMemory(joinedB.credential.token, -1)).toBeNull();
  });

  it("stores compact envelopes only", async () => {
    const created = createGuestSession({ role: "controller" });
    await publishSessionFeatures(created.credential.token, sampleEnvelope(9));
    const stored = getSessionFeaturesAfterMemory(created.credential.token, -1);
    expect(JSON.stringify(stored?.envelope)).not.toMatch(/bands|pcm|fft|MediaStream/);
  });

  it("records display acknowledgements for controller diagnostics", async () => {
    const created = createGuestSession({ role: "controller" });
    const joined = joinWithPairingCode({ code: created.pairingCode, role: "display" });
    recordFeatureReceiptMemory(joined.credential.token, {
      frameSeq: 12,
      receivedAtMs: Date.now(),
      transport: "fallback",
    });
    const receipt = getLatestFeatureReceiptMemory(created.credential.token);
    expect(receipt?.frameSeq).toBe(12);
    expect(receipt?.transport).toBe("fallback");
  });

  it("rejects stale envelopes", async () => {
    const created = createGuestSession({ role: "controller" });
    await expect(
      publishSessionFeatures(created.credential.token, sampleEnvelope(3, Date.now() - 5_000)),
    ).rejects.toThrow(/Stale/);
  });

  it("does not lose durable frame when realtime classification is failed", async () => {
    const created = createGuestSession({ role: "controller" });
    const result = await publishSessionFeaturesMemory(created.credential.token, sampleEnvelope(7));
    expect(result.durableFallback).toBe("stored");
    expect(getSessionFeaturesAfterMemory(created.credential.token, 6)?.frameSeq).toBe(7);
  });
});

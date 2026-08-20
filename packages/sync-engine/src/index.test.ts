import { describe, expect, it } from "vitest";

import { applyPongSample, createClockEstimate, sessionNowMs } from "./clock.js";
import { applyDisplayModeParams } from "./display-mode.js";
import { correctPlaybackDrift, projectPlaybackPosition } from "./playback.js";
import { applySessionMessage, createSyncEngineState } from "./reducer.js";
import { createSeqState, decideSeq } from "./seq.js";
import {
  containsForbiddenPayloadKeys,
  createThrottle,
  generatePairingCode,
  normalizePairingCodeInput,
} from "./security.js";

describe("sync-engine clock", () => {
  it("estimates offset from ping/pong", () => {
    let clock = createClockEstimate();
    clock = applyPongSample(clock, {
      clientSentAtMs: 1000,
      serverReceivedAtMs: 1100,
      serverSentAtMs: 1105,
      clientReceivedAtMs: 1200,
    });
    expect(clock.rttMs).toBe(200);
    expect(sessionNowMs(clock, 2000)).toBeCloseTo(2000 + clock.offsetMs, 5);
  });
});

describe("sync-engine playback", () => {
  it("projects position while playing and seeks on large drift", () => {
    const updatedAt = new Date(1_000_000).toISOString();
    const playback = {
      audioMode: "demo_track" as const,
      isPlaying: true,
      positionMs: 1000,
      rate: 1,
      trackId: "demo-track",
      updatedAt,
      seq: 1,
    };
    expect(projectPlaybackPosition(playback, 1_000_500)).toBe(1500);

    const large = correctPlaybackDrift({
      playback,
      localPositionMs: 1000,
      sessionNowMs: 1_001_000,
    });
    expect(large.correction).toBe("seek");

    const small = correctPlaybackDrift({
      playback,
      localPositionMs: 1490,
      sessionNowMs: 1_000_500,
    });
    expect(small.correction).toBe("none");
  });
});

describe("sync-engine seq", () => {
  it("rejects stale and gaps", () => {
    const state = createSeqState(5);
    const stale = decideSeq(state, {
      type: "heartbeat",
      seq: 4,
      sentAt: new Date().toISOString(),
      sessionId: "11111111-1111-4111-8111-111111111111",
      deviceId: "d1",
      payload: { deviceId: "d1" },
    });
    expect(stale.action).toBe("ignore_stale");

    const gap = decideSeq(state, {
      type: "heartbeat",
      seq: 8,
      sentAt: new Date().toISOString(),
      sessionId: "11111111-1111-4111-8111-111111111111",
      deviceId: "d1",
      payload: { deviceId: "d1" },
    });
    expect(gap.action).toBe("request_snapshot");
  });

  it("ignores stale snapshots so they cannot overwrite newer state", () => {
    const current = createSeqState(5);
    const staleSnapshot = decideSeq(current, {
      type: "session.snapshot",
      seq: 3,
      sentAt: new Date().toISOString(),
      sessionId: "11111111-1111-4111-8111-111111111111",
      deviceId: "d1",
      payload: {
        session: {
          id: "11111111-1111-4111-8111-111111111111",
          hostDeviceId: "d1",
          status: "active",
          displayMode: "mirror",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
          closedAt: null,
          seq: 3,
        },
        devices: [],
        playback: {
          audioMode: "demo_track",
          isPlaying: false,
          positionMs: 0,
          rate: 1,
          trackId: "demo-track",
          updatedAt: new Date().toISOString(),
          seq: 3,
        },
        preset: {
          visualizerId: "spectrum",
          qualityTier: "high",
          presetId: null,
          params: {},
          updatedAt: new Date().toISOString(),
          seq: 3,
        },
      },
    });
    expect(staleSnapshot.action).toBe("ignore_stale");
  });
});

describe("sync-engine reducer", () => {
  it("applies snapshot then incremental preset", () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const now = new Date().toISOString();
    let state = createSyncEngineState("controller-1");
    state = applySessionMessage(state, {
      type: "session.snapshot",
      seq: 1,
      sentAt: now,
      sessionId,
      deviceId: "controller-1",
      payload: {
        session: {
          id: sessionId,
          hostDeviceId: "controller-1",
          status: "active",
          displayMode: "mirror",
          createdAt: now,
          updatedAt: now,
          expiresAt: now,
          closedAt: null,
          seq: 1,
        },
        devices: [
          {
            id: "row-1",
            sessionId,
            deviceId: "controller-1",
            role: "controller",
            label: null,
            displayMode: "mirror",
            lastSeenAt: now,
            isOnline: true,
          },
        ],
        playback: {
          audioMode: "demo_track",
          isPlaying: false,
          positionMs: 0,
          rate: 1,
          trackId: "demo-track",
          updatedAt: now,
          seq: 1,
        },
        preset: {
          visualizerId: "spectrum",
          qualityTier: "high",
          presetId: null,
          params: {},
          updatedAt: now,
          seq: 1,
        },
      },
    }).state;

    const next = applySessionMessage(state, {
      type: "preset.apply",
      seq: 2,
      sentAt: now,
      sessionId,
      deviceId: "controller-1",
      payload: {
        visualizerId: "particles",
        qualityTier: "medium",
        presetId: "p1",
        params: { particleCount: 200 },
        updatedAt: now,
        seq: 2,
      },
    });
    expect(next.applied).toBe(true);
    expect(next.state.snapshot?.preset.visualizerId).toBe("particles");

    const stale = applySessionMessage(next.state, {
      type: "session.snapshot",
      seq: 1,
      sentAt: now,
      sessionId,
      deviceId: "controller-1",
      payload: {
        ...next.state.snapshot!,
        session: { ...next.state.snapshot!.session, seq: 1 },
        preset: {
          visualizerId: "spectrum",
          qualityTier: "high",
          presetId: null,
          params: {},
          updatedAt: now,
          seq: 1,
        },
      },
    });
    expect(stale.applied).toBe(false);
    expect(stale.state.snapshot?.preset.visualizerId).toBe("particles");
  });

  it("applies audio.features without advancing session seq", () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const now = new Date().toISOString();
    let state = createSyncEngineState("display-1");
    state = applySessionMessage(state, {
      type: "session.snapshot",
      seq: 4,
      sentAt: now,
      sessionId,
      deviceId: "display-1",
      payload: {
        session: {
          id: sessionId,
          hostDeviceId: "controller-1",
          status: "active",
          displayMode: "mirror",
          createdAt: now,
          updatedAt: now,
          expiresAt: now,
          closedAt: null,
          seq: 4,
        },
        devices: [],
        playback: {
          audioMode: "live_listen",
          isPlaying: true,
          positionMs: 0,
          rate: 1,
          trackId: "live-listen",
          updatedAt: now,
          seq: 4,
        },
        preset: {
          visualizerId: "spectrum",
          qualityTier: "high",
          presetId: null,
          params: {},
          updatedAt: now,
          seq: 4,
        },
      },
    }).state;
    const lastSeq = state.seq.lastAppliedSeq;
    const features = applySessionMessage(state, {
      type: "audio.features",
      seq: 99,
      sentAt: now,
      sessionId,
      deviceId: "controller-1",
      payload: {
        frameSeq: 3,
        timestampMs: Date.now(),
        rms: 0.2,
        energy: 0.4,
        bass: 0.1,
        mid: 0.1,
        high: 0.1,
        levels: [0, 0, 0, 0, 0, 0, 0, 0],
        onset: false,
        beatStrength: 0,
        centroid: 0,
      },
    });
    expect(features.applied).toBe(true);
    expect(features.requestSnapshot).toBe(false);
    expect(features.state.seq.lastAppliedSeq).toBe(lastSeq);
    expect(features.state.snapshot?.preset.visualizerId).toBe("spectrum");
  });
});

describe("sync-engine security + display", () => {
  it("generates codes and blocks forbidden keys", () => {
    const code = generatePairingCode(() => new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect(code).toHaveLength(6);
    expect(normalizePairingCodeInput(" ab-c12 ")).toBe("ABC12");
    expect(containsForbiddenPayloadKeys({ features: { bands: [1, 2] } })).toBe("features.bands");
    expect(containsForbiddenPayloadKeys({ visualizerId: "spectrum" })).toBeNull();
    expect(
      containsForbiddenPayloadKeys({
        frameSeq: 1,
        levels: [0.1, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
        energy: 0.2,
      }),
    ).toBeNull();
    expect(containsForbiddenPayloadKeys({ fft: [1, 2, 3] })).toBe("fft");
    expect(containsForbiddenPayloadKeys({ pcm: "nope" })).toBe("pcm");
    expect(
      containsForbiddenPayloadKeys({
        type: "audio.features",
        payload: { energy: 0.2, levels: [0.1], pcm: [0] },
      }),
    ).toBe("payload.pcm");
  });

  it("throttles and offsets complementary params", () => {
    const allow = createThrottle(10);
    expect(allow(1000)).toBe(true);
    expect(allow(1010)).toBe(false);
    expect(allow(1200)).toBe(true);
    const mirrored = applyDisplayModeParams({ hue: 10, speed: 1 }, "mirror", 2);
    expect(mirrored.hue).toBe(10);
    const comp = applyDisplayModeParams({ hue: 10, speed: 1 }, "complementary", 2);
    expect(comp.hue).not.toBe(10);
  });
});

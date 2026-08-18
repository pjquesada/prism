import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_SESSION_PAYLOAD_KEYS,
  PAIRING_CODE_LENGTH,
  pairingCodeSchema,
  publicGuestIdentitySchema,
  sessionClientMetaSchema,
  sessionMessageSchema,
  sessionSnapshotSchema,
} from "./session.js";

describe("session contracts", () => {
  it("accepts ambiguous-safe pairing codes only", () => {
    expect(pairingCodeSchema.parse("AB3K7M")).toBe("AB3K7M");
    expect(() => pairingCodeSchema.parse("ABCDEF")).not.toThrow();
    expect(() => pairingCodeSchema.parse("ABC01O")).toThrow();
    expect(() => pairingCodeSchema.parse("SHORT")).toThrow();
    expect(PAIRING_CODE_LENGTH).toBe(6);
  });

  it("parses a playback update envelope", () => {
    const msg = sessionMessageSchema.parse({
      type: "playback.update",
      seq: 3,
      sentAt: new Date().toISOString(),
      sessionId: "11111111-1111-4111-8111-111111111111",
      deviceId: "device-a",
      payload: {
        audioMode: "demo_track",
        isPlaying: true,
        positionMs: 1200,
        rate: 1,
        trackId: "demo-track",
        updatedAt: new Date().toISOString(),
        seq: 3,
      },
    });
    expect(msg.type).toBe("playback.update");
  });

  it("validates session snapshots", () => {
    const now = new Date().toISOString();
    const snap = sessionSnapshotSchema.parse({
      session: {
        id: "11111111-1111-4111-8111-111111111111",
        hostDeviceId: "host",
        status: "active",
        displayMode: "mirror",
        createdAt: now,
        updatedAt: now,
        expiresAt: now,
        closedAt: null,
        seq: 1,
      },
      devices: [],
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
    });
    expect(snap.session.status).toBe("active");
    expect(snap).not.toHaveProperty("pairingCode");
  });

  it("keeps public identity and sessionStorage meta free of credentials", () => {
    const identity = publicGuestIdentitySchema.parse({
      sessionId: "11111111-1111-4111-8111-111111111111",
      deviceId: "dev_a",
      role: "display",
      expiresAt: new Date().toISOString(),
    });
    expect(identity).not.toHaveProperty("token");
    const meta = sessionClientMetaSchema.parse({
      sessionId: identity.sessionId,
      deviceId: identity.deviceId,
      role: identity.role,
      intendedRoute: "display",
    });
    expect(JSON.stringify(meta)).not.toMatch(/token|secret/);
  });

  it("documents forbidden payload keys", () => {
    expect(FORBIDDEN_SESSION_PAYLOAD_KEYS).toContain("bands");
    expect(FORBIDDEN_SESSION_PAYLOAD_KEYS).toContain("fft");
    expect(FORBIDDEN_SESSION_PAYLOAD_KEYS).toContain("microphone");
  });
});

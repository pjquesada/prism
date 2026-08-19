import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  authorizeCredential,
  createGuestSession,
  getSnapshotForCredential,
  inspectCredentialStoreForTests,
  inspectPairingStoreForTests,
  joinWithPairingCode,
  publishAuthorizedMessage,
  resetSessionStoreForTests,
  rotatePairingCode,
} from "./memory-store";
import { resetRateLimitForTests } from "./rate-limit";

describe("memory session store", () => {
  afterEach(() => {
    resetSessionStoreForTests();
    resetRateLimitForTests();
  });

  it("creates a session with pairing code and allows a second device to join", () => {
    const created = createGuestSession({ role: "controller" });
    expect(created.pairingCode).toHaveLength(6);
    expect(created.credential.role).toBe("controller");
    expect(created.snapshot).not.toHaveProperty("pairingCode");

    const joined = joinWithPairingCode({
      code: created.pairingCode,
      role: "display",
      ip: "10.0.0.2",
    });
    expect(joined.snapshot.session.id).toBe(created.snapshot.session.id);
    expect(joined.credential.role).toBe("display");
    expect(joined.snapshot.devices.some((d) => d.role === "display")).toBe(true);
    expect(joined.snapshot).not.toHaveProperty("pairingCode");
  });

  it("stores HMAC pairing digests instead of plaintext or unsalted SHA-256", () => {
    const created = createGuestSession({ role: "controller" });
    const stored = inspectPairingStoreForTests(created.snapshot.session.id);
    expect(stored).toBeTruthy();
    expect(stored).not.toHaveProperty("code");
    expect(JSON.stringify(stored)).not.toContain(created.pairingCode);
    const unsalted = createHash("sha256").update(created.pairingCode).digest("hex");
    expect(stored?.codeHmac).not.toBe(unsalted);
    expect(stored?.codeHmac).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stores only a digest of the guest credential", () => {
    const created = createGuestSession({ role: "controller" });
    const stored = inspectCredentialStoreForTests(
      created.snapshot.session.id,
      created.credential.deviceId,
    );
    expect(stored?.secretHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(
      created.credential.token.split(".").slice(2).join("."),
    );
  });

  it("rejects invalid codes with a generic error", () => {
    createGuestSession({ role: "controller" });
    expect(() => joinWithPairingCode({ code: "ZZZZZZ", ip: "10.0.0.3" })).toThrow(
      /Invalid or expired/,
    );
  });

  it("invalidates the previous pairing code after rotation", () => {
    const created = createGuestSession({ role: "controller" });
    const rotated = rotatePairingCode(created.credential.token);
    expect(rotated.pairingCode).not.toBe(created.pairingCode);
    expect(() =>
      joinWithPairingCode({ code: created.pairingCode, role: "display", ip: "10.0.0.4" }),
    ).toThrow(/Invalid or expired/);
    const joined = joinWithPairingCode({
      code: rotated.pairingCode,
      role: "display",
      ip: "10.0.0.5",
    });
    expect(joined.snapshot.session.id).toBe(created.snapshot.session.id);
  });

  it("restores the controller from its credential, not the pairing code", () => {
    const created = createGuestSession({ role: "controller" });
    const snapshot = getSnapshotForCredential(created.credential.token);
    expect(snapshot).not.toHaveProperty("pairingCode");
    expect(() => authorizeCredential(created.pairingCode)).toThrow(/Unauthorized/);
  });

  it("broadcasts visual intent without feature bands", () => {
    const created = createGuestSession({ role: "controller" });
    const stamped = publishAuthorizedMessage(created.credential.token, {
      type: "visual.intent",
      seq: 0,
      sentAt: new Date().toISOString(),
      sessionId: created.snapshot.session.id,
      deviceId: created.credential.deviceId,
      payload: {
        visualizerId: "particles",
        params: { particleCount: 128 },
      },
    });
    expect(stamped.type).toBe("visual.intent");
    expect(JSON.stringify(stamped)).not.toMatch(/"bands"/);
  });

  it("rejects visualizer mutations from a display credential", () => {
    const created = createGuestSession({ role: "controller" });
    const joined = joinWithPairingCode({
      code: created.pairingCode,
      role: "display",
      ip: "10.0.0.12",
    });
    expect(() =>
      publishAuthorizedMessage(joined.credential.token, {
        type: "visual.intent",
        seq: 0,
        sentAt: new Date().toISOString(),
        sessionId: created.snapshot.session.id,
        deviceId: joined.credential.deviceId,
        payload: { visualizerId: "particles" },
      }),
    ).toThrow(/Displays cannot publish/);
    expect(() =>
      publishAuthorizedMessage(joined.credential.token, {
        type: "preset.apply",
        seq: 0,
        sentAt: new Date().toISOString(),
        sessionId: created.snapshot.session.id,
        deviceId: joined.credential.deviceId,
        payload: {
          visualizerId: "album_world",
          qualityTier: "high",
          presetId: null,
          params: {},
          updatedAt: new Date().toISOString(),
          seq: 0,
        },
      }),
    ).toThrow(/Displays cannot publish/);
    expect(getSnapshotForCredential(created.credential.token).preset.visualizerId).toBe("spectrum");
  });

  it("persists controller visualizer changes for later restore", () => {
    const created = createGuestSession({ role: "controller" });
    publishAuthorizedMessage(created.credential.token, {
      type: "visual.intent",
      seq: 0,
      sentAt: new Date().toISOString(),
      sessionId: created.snapshot.session.id,
      deviceId: created.credential.deviceId,
      payload: { visualizerId: "particles" },
    });
    expect(getSnapshotForCredential(created.credential.token).preset.visualizerId).toBe(
      "particles",
    );
    publishAuthorizedMessage(created.credential.token, {
      type: "preset.apply",
      seq: 0,
      sentAt: new Date().toISOString(),
      sessionId: created.snapshot.session.id,
      deviceId: created.credential.deviceId,
      payload: {
        visualizerId: "album_world",
        qualityTier: "high",
        presetId: "builtin-album-world-drift",
        params: { parallaxStrength: 1.2 },
        updatedAt: new Date().toISOString(),
        seq: 0,
      },
    });
    const restored = getSnapshotForCredential(created.credential.token);
    expect(restored.preset.visualizerId).toBe("album_world");
    expect(restored.preset.seq).toBeGreaterThan(created.snapshot.preset.seq);
    expect(restored.session.seq).toBeGreaterThan(created.snapshot.session.seq);
  });
});

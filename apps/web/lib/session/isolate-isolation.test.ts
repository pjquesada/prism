import { afterEach, describe, expect, it } from "vitest";

import {
  createGuestSession,
  getSnapshotForCredential,
  joinWithPairingCode,
  publishAuthorizedMessage,
  resetSessionStoreForTests,
} from "./memory-store";

/**
 * Documents the production failure mode: two isolates do not share memory.
 * Durable Supabase persistence is required for cross-instance join/restore.
 */
describe("memory store isolate isolation", () => {
  afterEach(() => {
    resetSessionStoreForTests();
  });

  it("cannot authorize a credential against a fresh empty store", () => {
    const created = createGuestSession({ role: "controller" });
    const token = created.credential.token;
    const snapshot = getSnapshotForCredential(token);
    expect(snapshot.session.id).toBe(created.snapshot.session.id);

    // Simulate another serverless isolate with an empty Map.
    resetSessionStoreForTests();
    expect(() => getSnapshotForCredential(token)).toThrow(/Unauthorized/);
    expect(() =>
      joinWithPairingCode({ code: created.pairingCode, role: "display", ip: "10.0.0.9" }),
    ).toThrow(/Invalid or expired/);
  });

  it("keeps canonical playback/preset on the create isolate for joining displays", () => {
    const created = createGuestSession({ role: "controller" });
    publishAuthorizedMessage(created.credential.token, {
      type: "visual.intent",
      seq: 0,
      sentAt: new Date().toISOString(),
      sessionId: created.snapshot.session.id,
      deviceId: created.credential.deviceId,
      payload: { visualizerId: "particles" },
    });
    const joined = joinWithPairingCode({
      code: created.pairingCode,
      role: "display",
      ip: "10.0.0.8",
    });
    const displaySnapshot = getSnapshotForCredential(joined.credential.token);
    expect(displaySnapshot.preset.visualizerId).toBe("particles");
    // Joining display does not require a live controller publish after join.
    expect(displaySnapshot.session.id).toBe(created.snapshot.session.id);
  });
});

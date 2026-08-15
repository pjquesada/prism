import { afterEach, describe, expect, it } from "vitest";

import {
  createGuestSession,
  joinWithPairingCode,
  publishAuthorizedMessage,
  resetSessionStoreForTests,
} from "./memory-store";

describe("memory session store", () => {
  afterEach(() => {
    resetSessionStoreForTests();
  });

  it("creates a session with pairing code and allows a second device to join", () => {
    const created = createGuestSession({ role: "controller" });
    expect(created.pairingCode).toHaveLength(6);
    expect(created.credential.role).toBe("controller");

    const joined = joinWithPairingCode({
      code: created.pairingCode,
      role: "display",
      ip: "10.0.0.2",
    });
    expect(joined.snapshot.session.id).toBe(created.snapshot.session.id);
    expect(joined.credential.role).toBe("display");
    expect(joined.snapshot.devices.some((d) => d.role === "display")).toBe(true);
  });

  it("rejects invalid codes with a generic error", () => {
    createGuestSession({ role: "controller" });
    expect(() => joinWithPairingCode({ code: "ZZZZZZ", ip: "10.0.0.3" })).toThrow(
      /Invalid or expired/,
    );
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
});

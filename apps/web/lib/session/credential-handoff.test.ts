import { afterEach, describe, expect, it } from "vitest";

import {
  stashCredentialHandoff,
  storeCredential,
  takeCredentialForSession,
} from "./use-session-client";

describe("credential handoff storage", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("prefers sessionStorage handoff after join navigation", () => {
    stashCredentialHandoff({
      token: "sess.dev.secret",
      sessionId: "11111111-1111-4111-8111-111111111111",
      deviceId: "dev_a",
      role: "display",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const taken = takeCredentialForSession("11111111-1111-4111-8111-111111111111");
    expect(taken?.deviceId).toBe("dev_a");
    expect(window.sessionStorage.getItem("prism.session.credential.handoff.v1")).toBeNull();
    expect(window.localStorage.getItem("prism.session.credential.v1")).toContain("dev_a");
  });

  it("falls back to localStorage when handoff is absent", () => {
    storeCredential({
      token: "sess.dev.secret2",
      sessionId: "22222222-2222-4222-8222-222222222222",
      deviceId: "dev_b",
      role: "controller",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const taken = takeCredentialForSession("22222222-2222-4222-8222-222222222222");
    expect(taken?.deviceId).toBe("dev_b");
  });

  it("returns null for a mismatched session id", () => {
    storeCredential({
      token: "sess.dev.secret3",
      sessionId: "33333333-3333-4333-8333-333333333333",
      deviceId: "dev_c",
      role: "display",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(takeCredentialForSession("44444444-4444-4444-8444-444444444444")).toBeNull();
  });
});

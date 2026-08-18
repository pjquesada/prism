import { afterEach, describe, expect, it } from "vitest";

import { stashSessionMeta, takeSessionMeta } from "./session-meta";

describe("session metadata storage", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("stores only non-sensitive metadata in sessionStorage", () => {
    stashSessionMeta({
      sessionId: "11111111-1111-4111-8111-111111111111",
      deviceId: "dev_a",
      role: "display",
      intendedRoute: "display",
    });

    const raw = window.sessionStorage.getItem("prism.session.meta.v1");
    expect(raw).toContain("dev_a");
    expect(raw).not.toMatch(/token|secret|credential/i);
    expect(window.localStorage.length).toBe(0);

    const taken = takeSessionMeta("11111111-1111-4111-8111-111111111111");
    expect(taken?.deviceId).toBe("dev_a");
    expect(window.sessionStorage.getItem("prism.session.meta.v1")).toBeNull();
  });

  it("returns null for a mismatched session id", () => {
    stashSessionMeta({
      sessionId: "33333333-3333-4333-8333-333333333333",
      deviceId: "dev_c",
      role: "display",
    });
    expect(takeSessionMeta("44444444-4444-4444-8444-444444444444")).toBeNull();
  });

  it("works when localStorage throws", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
        clear: () => {
          throw new Error("blocked");
        },
        key: () => null,
        length: 0,
      },
    });
    stashSessionMeta({
      sessionId: "11111111-1111-4111-8111-111111111111",
      deviceId: "dev_private",
      role: "controller",
      intendedRoute: "controller",
    });
    expect(takeSessionMeta("11111111-1111-4111-8111-111111111111")?.deviceId).toBe("dev_private");
    Object.defineProperty(window, "localStorage", { configurable: true, value: original });
  });
});

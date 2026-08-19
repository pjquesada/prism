import { describe, expect, it, vi } from "vitest";

import { logSessionBackendEvent, redactForServerLog } from "@/lib/session/backend-log";

describe("redactForServerLog", () => {
  it("redacts signing secrets and service role values", () => {
    const input =
      "SESSION_SIGNING_SECRET=super-secret-key-value service_role=eyJhbGciOiJIUzI1NiJ9.token";
    const redacted = redactForServerLog(input);
    expect(redacted).not.toContain("super-secret-key-value");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(redacted).toContain("[redacted]");
  });

  it("redacts long opaque tokens", () => {
    const redacted = redactForServerLog("credential=abcdefghijklmnopqrstuvwxyz1234567890");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");
  });
});

describe("logSessionBackendEvent", () => {
  it("logs only sanitized operation metadata", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logSessionBackendEvent({
      operation: "createGuestSession.writes",
      table: "pairing_codes",
      category: "schema_mismatch",
      code: "schema_mismatch",
      pgCode: "PGRST204",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(logged).toEqual({
      scope: "session_backend",
      operation: "createGuestSession.writes",
      table: "pairing_codes",
      category: "schema_mismatch",
      code: "schema_mismatch",
      pgCode: "PGRST204",
    });
    expect(JSON.stringify(logged)).not.toMatch(/code_hash|SESSION_SIGNING_SECRET|pairingCode/);
    spy.mockRestore();
  });
});

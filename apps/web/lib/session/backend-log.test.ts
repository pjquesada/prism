import { describe, expect, it } from "vitest";

import { redactForServerLog } from "@/lib/session/backend-log";

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

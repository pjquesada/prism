import { describe, expect, it } from "vitest";

import { jsonError } from "@/lib/session/api-helpers";
import { safeMessageForCode } from "@/lib/session/safe-errors";

describe("safe session errors", () => {
  it("returns browser-safe messages without secret values", () => {
    const res = jsonError("server_misconfigured", "SESSION_SIGNING_SECRET is not configured.", 503);
    expect(res.status).toBe(503);
    return res.json().then((body: { error: { code: string; message: string } }) => {
      expect(body.error.code).toBe("server_misconfigured");
      expect(body.error.message).toBe(safeMessageForCode("server_misconfigured"));
      expect(body.error.message).not.toContain("SESSION_SIGNING_SECRET");
      expect(body.error.message).not.toMatch(/supabase/i);
    });
  });

  it("maps schema mismatch to a safe message", async () => {
    const res = jsonError("schema_mismatch", 'column "revoked_at" does not exist', 503);
    const body = await res.json();
    expect(body.error.message).toBe("Session database schema is out of date.");
    expect(body.error.message).not.toContain("revoked_at");
  });
});

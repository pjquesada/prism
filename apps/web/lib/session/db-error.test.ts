import { describe, expect, it } from "vitest";

import { classifyDatabaseError } from "@/lib/session/db-error";

describe("classifyDatabaseError", () => {
  it("maps missing migration columns to schema_mismatch", () => {
    expect(classifyDatabaseError('column "revoked_at" does not exist')).toBe("schema_mismatch");
    expect(
      classifyDatabaseError("null value in column code_hint violates not-null constraint"),
    ).toBe("schema_mismatch");
  });

  it("maps generic database failures to session_backend_unavailable", () => {
    expect(classifyDatabaseError("connection timeout")).toBe("session_backend_unavailable");
  });
});

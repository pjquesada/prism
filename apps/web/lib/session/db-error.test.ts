import { describe, expect, it } from "vitest";

import { classifyDatabaseError, classifySupabaseFailure } from "@/lib/session/db-error";

describe("classifySupabaseFailure", () => {
  it("maps PostgREST schema-cache misses to schema_mismatch", () => {
    expect(
      classifySupabaseFailure({
        code: "PGRST204",
        message: "Could not find the 'revoked_at' column of 'pairing_codes' in the schema cache",
      }),
    ).toBe("schema_mismatch");
    expect(classifyDatabaseError('column "revoked_at" does not exist', "42703")).toBe(
      "schema_mismatch",
    );
    expect(
      classifyDatabaseError("null value in column code_hint violates not-null constraint", "23502"),
    ).toBe("schema_mismatch");
  });

  it("maps check failures to constraint_violation", () => {
    expect(
      classifySupabaseFailure({
        code: "23514",
        message: "new row violates check constraint pairing_codes_code_hash_hmac_chk",
      }),
    ).toBe("constraint_violation");
    expect(
      classifyDatabaseError(
        "new row violates check constraint pairing_codes_code_hash_hmac_chk",
        "23514",
      ),
    ).toBe("constraint_violation");
  });

  it("maps generic database failures to database_unavailable", () => {
    expect(classifyDatabaseError("connection timeout")).toBe("database_unavailable");
  });

  it("maps auth and API-key failures to configuration_error", () => {
    expect(classifySupabaseFailure({ code: "42501", message: "permission denied" })).toBe(
      "configuration_error",
    );
    expect(classifyDatabaseError("Invalid API key", "PGRST301")).toBe("configuration_error");
  });
});

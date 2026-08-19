import type { SessionErrorCode } from "@/lib/session/errors";

/**
 * Map Supabase/Postgres errors to safe client-facing categories.
 * Never return raw database messages to browsers.
 */
export function classifyDatabaseError(message: string): SessionErrorCode {
  const lower = message.toLowerCase();

  if (
    lower.includes("code_hint") ||
    (lower.includes("revoked_at") && lower.includes("does not exist")) ||
    (lower.includes("column") && lower.includes("does not exist")) ||
    (lower.includes("relation") && lower.includes("does not exist")) ||
    lower.includes("schema cache") ||
    (lower.includes("violates check constraint") &&
      (lower.includes("code_hash") || lower.includes("secret_hash")))
  ) {
    return "schema_mismatch";
  }

  return "session_backend_unavailable";
}

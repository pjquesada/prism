import type { SessionErrorCode } from "@/lib/session/errors";

export type DatabaseFailureCategory =
  "schema_mismatch" | "constraint_violation" | "database_unavailable" | "configuration_error";

export type SupabaseFailure = {
  message?: string;
  code?: string | null;
  details?: string | null;
};

const HMAC_CHECK_RE = /code_hash|secret_hash/;
const SCHEMA_MESSAGE_RE =
  /code_hint|\bschema cache\b|does not exist|pgrst204|42703|42p01|revoked_at/;

function failureText(error: SupabaseFailure): string {
  return `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
}

/**
 * Map Supabase/Postgres errors to safe categories.
 * Never return raw database messages or payloads to browsers.
 */
export function classifySupabaseFailure(error: SupabaseFailure): DatabaseFailureCategory {
  const pgCode = (error.code ?? "").toUpperCase();
  const text = failureText(error);

  if (
    pgCode === "PGRST204" ||
    pgCode === "42703" ||
    pgCode === "42P01" ||
    SCHEMA_MESSAGE_RE.test(text) ||
    (pgCode === "23502" && text.includes("code_hint"))
  ) {
    return "schema_mismatch";
  }

  if (
    pgCode === "23502" ||
    pgCode === "23503" ||
    pgCode === "23505" ||
    pgCode === "23514" ||
    text.includes("violates") ||
    HMAC_CHECK_RE.test(text)
  ) {
    return "constraint_violation";
  }

  if (
    pgCode === "42501" ||
    pgCode === "28000" ||
    text.includes("not configured") ||
    text.includes("invalid api key") ||
    text.includes("jwt")
  ) {
    return "configuration_error";
  }

  return "database_unavailable";
}

export function sessionErrorCodeForCategory(category: DatabaseFailureCategory): SessionErrorCode {
  switch (category) {
    case "schema_mismatch":
      return "schema_mismatch";
    case "constraint_violation":
      return "constraint_violation";
    case "configuration_error":
      return "configuration_error";
    case "database_unavailable":
    default:
      return "database_unavailable";
  }
}

export function classifyDatabaseError(message: string, code?: string | null): SessionErrorCode {
  return sessionErrorCodeForCategory(classifySupabaseFailure({ message, code }));
}

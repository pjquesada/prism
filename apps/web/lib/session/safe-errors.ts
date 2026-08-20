import type { SessionErrorCode } from "@/lib/session/errors";

/** Browser-safe messages keyed by error code. Never include secrets or raw DB text. */
export const SAFE_SESSION_ERROR_MESSAGES: Record<SessionErrorCode, string> = {
  invalid_or_expired: "Invalid or expired pairing code.",
  rate_limited: "Too many attempts. Try again later.",
  unauthorized: "Unauthorized.",
  ended: "Session has ended.",
  not_found: "Session not found.",
  payload_too_large: "Request payload too large.",
  forbidden_payload: "Request payload is not allowed.",
  invalid_request: "Invalid session event.",
  backend_unavailable: "Session service is temporarily unavailable.",
  server_misconfigured: "Session service is not configured on the server.",
  session_backend_unavailable: "Session service is temporarily unavailable.",
  schema_mismatch: "Session database schema is out of date.",
  constraint_violation: "Session database rejected the request.",
  database_unavailable: "Session database is temporarily unavailable.",
  configuration_error: "Session service is not configured on the server.",
};

export function safeMessageForCode(code: SessionErrorCode): string {
  return SAFE_SESSION_ERROR_MESSAGES[code] ?? SAFE_SESSION_ERROR_MESSAGES.backend_unavailable;
}

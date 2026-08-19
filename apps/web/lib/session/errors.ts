export type SessionErrorCode =
  | "invalid_or_expired"
  | "rate_limited"
  | "unauthorized"
  | "ended"
  | "not_found"
  | "payload_too_large"
  | "forbidden_payload"
  /** @deprecated Prefer session_backend_unavailable or server_misconfigured */
  | "backend_unavailable"
  | "server_misconfigured"
  | "session_backend_unavailable"
  | "schema_mismatch"
  | "constraint_violation"
  | "database_unavailable"
  | "configuration_error";

export class SessionServiceError extends Error {
  readonly code: SessionErrorCode;
  readonly status: number;

  constructor(code: SessionErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

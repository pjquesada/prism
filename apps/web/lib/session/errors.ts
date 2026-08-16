export type SessionErrorCode =
  | "invalid_or_expired"
  | "rate_limited"
  | "unauthorized"
  | "ended"
  | "not_found"
  | "payload_too_large"
  | "forbidden_payload"
  | "backend_unavailable";

export class SessionServiceError extends Error {
  readonly code: SessionErrorCode;
  readonly status: number;

  constructor(code: SessionErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

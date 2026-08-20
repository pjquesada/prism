import { z } from "zod";

import { deviceRoleSchema, displayModeSchema, sessionMessageSchema } from "@prism/contracts";
import { containsForbiddenPayloadKeys, normalizePairingCodeInput } from "@prism/sync-engine";

import { getAppUrl } from "@/lib/session/config";
import { SessionServiceError, type SessionErrorCode } from "@/lib/session/errors";
import { safeMessageForCode } from "@/lib/session/safe-errors";

export const GUEST_CREDENTIAL_COOKIE_PREFIX = "prism_guest_";

export const createSessionBodySchema = z.object({
  role: deviceRoleSchema.default("combined"),
  displayMode: displayModeSchema.default("mirror"),
  hostDeviceId: z.string().min(1).max(120).optional(),
});

export const joinSessionBodySchema = z.object({
  code: z.string().min(4).max(12),
  role: deviceRoleSchema.default("display"),
  deviceId: z.string().min(1).max(120).optional(),
  label: z.string().max(80).nullable().optional(),
});

export const handoffBodySchema = z.object({
  targetDeviceId: z.string().min(1),
});

export const broadcastBodySchema = z.object({
  message: sessionMessageSchema,
});

export const sessionIdParamSchema = z.string().uuid();

export function guestCredentialCookieName(sessionId: string): string {
  return `${GUEST_CREDENTIAL_COOKIE_PREFIX}${sessionId}`;
}

export function parseJoinCode(raw: string): string {
  return normalizePairingCodeInput(raw);
}

export function assertSafeSessionPayload(payload: unknown): void {
  const forbidden = containsForbiddenPayloadKeys(payload);
  if (forbidden) {
    throw new Error(`forbidden_payload:${forbidden}`);
  }
}

export function jsonError(code: string, message: string, status: number): Response {
  const known = code as SessionErrorCode;
  const knownCodes: SessionErrorCode[] = [
    "invalid_or_expired",
    "rate_limited",
    "unauthorized",
    "ended",
    "not_found",
    "payload_too_large",
    "forbidden_payload",
    "backend_unavailable",
    "server_misconfigured",
    "session_backend_unavailable",
    "schema_mismatch",
    "constraint_violation",
    "database_unavailable",
    "configuration_error",
  ];
  const bodyMessage = knownCodes.includes(known) ? safeMessageForCode(known) : message;
  return Response.json({ error: { code, message: bodyMessage } }, { status });
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

/**
 * Session-scoped HttpOnly cookie is authoritative for browsers.
 * Optional Bearer token is for same-origin tests that hold the mint response.
 */
export function getGuestTokenFromRequest(request: Request, sessionId: string): string | null {
  const cookieToken = getCookie(request, guestCredentialCookieName(sessionId));
  const bearer = getBearerToken(request);
  return cookieToken ?? bearer;
}

function cookieSecure(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://") === true
  );
}

export function guestCredentialSetCookieHeader(
  sessionId: string,
  token: string,
  expiresAt: string,
): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  const parts = [
    `${guestCredentialCookieName(sessionId)}=${encodeURIComponent(token)}`,
    "Path=/api/session",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (cookieSecure()) parts.push("Secure");
  return parts.join("; ");
}

export function guestCredentialClearCookieHeader(sessionId: string): string {
  const parts = [
    `${guestCredentialCookieName(sessionId)}=`,
    "Path=/api/session",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (cookieSecure()) parts.push("Secure");
  return parts.join("; ");
}

export function jsonWithGuestCredential(
  body: unknown,
  credential: { token: string; sessionId: string; expiresAt: string },
  init?: { status?: number },
): Response {
  const response = Response.json(body, { status: init?.status });
  response.headers.append(
    "Set-Cookie",
    guestCredentialSetCookieHeader(credential.sessionId, credential.token, credential.expiresAt),
  );
  return response;
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

export function assertMutatingSameOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (!origin) {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.PRISM_ALLOW_MEMORY_SESSIONS !== "true"
    ) {
      throw new SessionServiceError("unauthorized", "Unauthorized.", 401);
    }
    return;
  }
  let expectedHost: string;
  try {
    expectedHost = new URL(getAppUrl()).host;
  } catch {
    expectedHost = request.headers.get("host") ?? "";
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new SessionServiceError("unauthorized", "Unauthorized.", 401);
  }
  const requestHost = request.headers.get("host");
  if (originHost !== expectedHost && originHost !== requestHost) {
    throw new SessionServiceError("unauthorized", "Unauthorized.", 401);
  }
}

import { z } from "zod";

import { deviceRoleSchema, displayModeSchema, sessionMessageSchema } from "@prism/contracts";
import { containsForbiddenPayloadKeys, normalizePairingCodeInput } from "@prism/sync-engine";

export const GUEST_CREDENTIAL_COOKIE = "prism_guest_cred";

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
  return Response.json({ error: { code, message } }, { status });
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

/** Bearer token wins; HttpOnly cookie is the private-Safari / storage-blocked fallback. */
export function getGuestTokenFromRequest(request: Request): string | null {
  return getBearerToken(request) ?? getCookie(request, GUEST_CREDENTIAL_COOKIE);
}

export function guestCredentialSetCookieHeader(token: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://") === true;
  const parts = [
    `${GUEST_CREDENTIAL_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function guestCredentialClearCookieHeader(): string {
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://") === true;
  const parts = [`${GUEST_CREDENTIAL_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function jsonWithGuestCredential(
  body: unknown,
  credential: { token: string; expiresAt: string },
  init?: { status?: number },
): Response {
  const response = Response.json(body, { status: init?.status });
  response.headers.append(
    "Set-Cookie",
    guestCredentialSetCookieHeader(credential.token, credential.expiresAt),
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

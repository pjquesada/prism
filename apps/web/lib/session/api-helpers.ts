import { z } from "zod";

import { deviceRoleSchema, displayModeSchema, sessionMessageSchema } from "@prism/contracts";
import { containsForbiddenPayloadKeys, normalizePairingCodeInput } from "@prism/sync-engine";

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

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

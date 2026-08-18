import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { pairingCodeSchema } from "@prism/contracts";
import { normalizePairingCodeInput } from "@prism/sync-engine";

/** Minimum HMAC key length (256 bits). */
export const SESSION_SIGNING_SECRET_MIN_BYTES = 32;

/** Opaque guest credential entropy (256 bits). */
export const GUEST_CREDENTIAL_ENTROPY_BYTES = 32;

export function hmacSha256Hex(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function digestPairingCode(normalizedCode: string, signingSecret: string): string {
  return hmacSha256Hex(normalizedCode, signingSecret);
}

export function digestGuestCredential(secretMaterial: string, signingSecret: string): string {
  return hmacSha256Hex(secretMaterial, signingSecret);
}

export function timingSafeDigestEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function normalizeAndValidatePairingCode(raw: string): string | null {
  const normalized = normalizePairingCodeInput(raw);
  const parsed = pairingCodeSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

export function generateGuestCredentialSecret(): string {
  return randomBytes(GUEST_CREDENTIAL_ENTROPY_BYTES).toString("base64url");
}

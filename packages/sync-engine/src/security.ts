import {
  FORBIDDEN_SESSION_PAYLOAD_KEYS,
  MAX_SESSION_EVENT_BYTES,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  pairingCodeSchema,
} from "@prism/contracts";

export function generatePairingCode(randomBytes?: (size: number) => Uint8Array): string {
  const bytes =
    randomBytes?.(PAIRING_CODE_LENGTH) ??
    (typeof crypto !== "undefined" && "getRandomValues" in crypto
      ? crypto.getRandomValues(new Uint8Array(PAIRING_CODE_LENGTH))
      : Uint8Array.from({ length: PAIRING_CODE_LENGTH }, () => Math.floor(Math.random() * 256)));

  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[bytes[i]! % PAIRING_CODE_ALPHABET.length]!;
  }
  return pairingCodeSchema.parse(code);
}

export function normalizePairingCodeInput(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function assertPayloadSize(payload: unknown, maxBytes = MAX_SESSION_EVENT_BYTES): void {
  const size = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (size > maxBytes) {
    throw new Error(`payload_too_large:${size}`);
  }
}

export function containsForbiddenPayloadKeys(value: unknown, path: string[] = []): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = containsForbiddenPayloadKeys(value[i], [...path, String(i)]);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_SESSION_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      return [...path, key].join(".");
    }
    const hit = containsForbiddenPayloadKeys(child, [...path, key]);
    if (hit) return hit;
  }
  return null;
}

export function createThrottle(maxHz: number): (nowMs?: number) => boolean {
  const minInterval = 1000 / Math.max(1, maxHz);
  let last = 0;
  return (nowMs = Date.now()) => {
    if (nowMs - last < minInterval) return false;
    last = nowMs;
    return true;
  };
}

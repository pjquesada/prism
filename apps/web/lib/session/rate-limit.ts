import { SessionServiceError } from "@/lib/session/errors";

const JOIN_RATE_LIMIT = 20;
const JOIN_RATE_WINDOW_MS = 60_000;
const ROTATE_RATE_LIMIT = 10;
const ROTATE_RATE_WINDOW_MS = 60_000;

type Bucket = { count: number; windowStart: number };

type GlobalRateLimit = {
  buckets: Map<string, Bucket>;
};

function getStore(): GlobalRateLimit {
  const g = globalThis as typeof globalThis & { __prismSessionRateLimit?: GlobalRateLimit };
  if (!g.__prismSessionRateLimit) {
    g.__prismSessionRateLimit = { buckets: new Map() };
  }
  return g.__prismSessionRateLimit;
}

export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const store = getStore();
  const now = Date.now();
  const entry = store.buckets.get(key) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > windowMs) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  store.buckets.set(key, entry);
  if (entry.count > limit) {
    throw new SessionServiceError("rate_limited", "Too many attempts. Try again later.", 429);
  }
}

export function enforceJoinRateLimit(ip: string): void {
  enforceRateLimit(`join:${ip}`, JOIN_RATE_LIMIT, JOIN_RATE_WINDOW_MS);
}

export function enforceRotateRateLimit(ip: string, sessionId: string): void {
  enforceRateLimit(`rotate:${ip}`, ROTATE_RATE_LIMIT, ROTATE_RATE_WINDOW_MS);
  enforceRateLimit(`rotate-session:${sessionId}`, ROTATE_RATE_LIMIT, ROTATE_RATE_WINDOW_MS);
}

export function resetRateLimitForTests(): void {
  getStore().buckets.clear();
}

import { readSupabaseAdminEnv, readSupabasePublicEnv } from "@prism/db";

import { SESSION_SIGNING_SECRET_MIN_BYTES } from "@/lib/session/crypto";
import { SessionServiceError } from "@/lib/session/errors";

export type SessionTransportKind = "memory" | "supabase";

const MEMORY_BACKEND = "memory";
const SUPABASE_BACKEND = "supabase";

function explicitBackend(): SessionTransportKind | null {
  const raw = process.env.PRISM_SESSION_BACKEND?.trim().toLowerCase();
  if (raw === MEMORY_BACKEND || raw === SUPABASE_BACKEND) return raw;
  return null;
}

function memoryExplicitlyAllowed(): boolean {
  return explicitBackend() === MEMORY_BACKEND || process.env.PRISM_ALLOW_MEMORY_SESSIONS === "true";
}

/** Production runtime that must fail closed (no in-memory session fallback). */
export function isFailClosedProduction(): boolean {
  return process.env.NODE_ENV === "production" && !memoryExplicitlyAllowed();
}

export function isRealtimeConfigured(): boolean {
  return readSupabasePublicEnv() !== null;
}

export function isDurableSessionBackend(): boolean {
  return resolveSessionTransport() === SUPABASE_BACKEND;
}

export function getSessionSigningSecret(): string {
  const secret = process.env.SESSION_SIGNING_SECRET?.trim() ?? "";
  if (!secret) {
    throw new SessionServiceError(
      "backend_unavailable",
      "SESSION_SIGNING_SECRET is not configured.",
      503,
    );
  }
  if (Buffer.byteLength(secret, "utf8") < SESSION_SIGNING_SECRET_MIN_BYTES) {
    throw new SessionServiceError(
      "backend_unavailable",
      "SESSION_SIGNING_SECRET is too short.",
      503,
    );
  }
  return secret;
}

function requireSupabaseAdmin(): void {
  if (readSupabaseAdminEnv() === null) {
    throw new SessionServiceError(
      "backend_unavailable",
      "Supabase server credentials are not configured.",
      503,
    );
  }
}

/**
 * Resolves the active session implementation.
 * Production fails closed unless memory is explicitly allowed for local/e2e tests.
 * Never silently falls back to process memory after config or database failures.
 */
export function resolveSessionTransport(): SessionTransportKind {
  const explicit = explicitBackend();
  const allowMemory = memoryExplicitlyAllowed();

  if (isFailClosedProduction()) {
    requireSupabaseAdmin();
    getSessionSigningSecret();
    return SUPABASE_BACKEND;
  }

  if (explicit === SUPABASE_BACKEND) {
    requireSupabaseAdmin();
    getSessionSigningSecret();
    return SUPABASE_BACKEND;
  }

  if (allowMemory || explicit === MEMORY_BACKEND) {
    getSessionSigningSecret();
    return MEMORY_BACKEND;
  }

  if (readSupabaseAdminEnv() !== null) {
    getSessionSigningSecret();
    return SUPABASE_BACKEND;
  }

  // Local development without an explicit backend: memory, still requires signing secret.
  getSessionSigningSecret();
  return MEMORY_BACKEND;
}

export function getSessionTransport(): SessionTransportKind {
  return resolveSessionTransport();
}

export function getAppUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "http://localhost:3000";
}

export function buildJoinUrl(code: string): string {
  return `${getAppUrl()}/join?code=${encodeURIComponent(code)}`;
}

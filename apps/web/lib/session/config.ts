import { readSupabaseAdminEnv, readSupabasePublicEnv } from "@prism/db";

export type SessionTransportKind = "memory" | "supabase";

/** True when public Supabase env is present (Realtime client possible). */
export function isRealtimeConfigured(): boolean {
  return readSupabasePublicEnv() !== null;
}

/**
 * Durable cross-instance sessions require the service-role admin client.
 * Public-only env is not enough — claiming "supabase" without persistence caused
 * production pairing failures on Vercel.
 */
export function isDurableSessionBackend(): boolean {
  return readSupabaseAdminEnv() !== null;
}

export function getSessionTransport(): SessionTransportKind {
  return isDurableSessionBackend() ? "supabase" : "memory";
}

export function getAppUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "http://localhost:3000";
}

export function buildJoinUrl(code: string): string {
  return `${getAppUrl()}/join?code=${encodeURIComponent(code)}`;
}

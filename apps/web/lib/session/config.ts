import { readSupabasePublicEnv } from "@prism/db";

/** True when public Supabase env is present. Session APIs still work via memory store otherwise. */
export function isRealtimeConfigured(): boolean {
  return readSupabasePublicEnv() !== null;
}

export function getAppUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "http://localhost:3000";
}

export function buildJoinUrl(code: string): string {
  return `${getAppUrl()}/join?code=${encodeURIComponent(code)}`;
}

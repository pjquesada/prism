import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types.js";

export type PrismSupabaseClient = SupabaseClient<Database>;

export type SupabasePublicConfig = {
  url: string;
  anonKey: string;
};

export type SupabaseAdminConfig = SupabasePublicConfig & {
  serviceRoleKey: string;
};

export function isSupabaseConfigured(env: {
  url?: string | null;
  anonKey?: string | null;
}): boolean {
  return Boolean(env.url?.trim() && env.anonKey?.trim());
}

export function isSupabaseAdminConfigured(env: {
  url?: string | null;
  anonKey?: string | null;
  serviceRoleKey?: string | null;
}): boolean {
  return isSupabaseConfigured(env) && Boolean(env.serviceRoleKey?.trim());
}

/** Browser / authed-user client. Never pass the service role key here. */
export function createBrowserSupabaseClient(config: SupabasePublicConfig): PrismSupabaseClient {
  return createClient<Database>(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Server-only admin client. Callers must ensure this never reaches a client bundle.
 */
export function createAdminSupabaseClient(config: SupabaseAdminConfig): PrismSupabaseClient {
  return createClient<Database>(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function readSupabasePublicEnv(
  env: NodeJS.ProcessEnv = process.env,
): SupabasePublicConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function readSupabaseAdminEnv(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseAdminConfig | null {
  const publicConfig = readSupabasePublicEnv(env);
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!publicConfig || !serviceRoleKey) return null;
  return { ...publicConfig, serviceRoleKey };
}

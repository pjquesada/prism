import { createAdminSupabaseClient, readSupabaseAdminEnv } from "@prism/db";

/**
 * Server-only admin client. Returns null when Supabase is not configured.
 * Never import this module from client components.
 */
export function createOptionalAdminSupabase() {
  const config = readSupabaseAdminEnv();
  if (!config) return null;
  return createAdminSupabaseClient(config);
}

import { createBrowserSupabaseClient, readSupabasePublicEnv } from "@prism/db";

export function createOptionalBrowserSupabase() {
  const config = readSupabasePublicEnv();
  if (!config) return null;
  return createBrowserSupabaseClient(config);
}

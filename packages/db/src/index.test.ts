import { describe, expect, it } from "vitest";

import { isSupabaseAdminConfigured, isSupabaseConfigured, readSupabaseAdminEnv } from "./client.js";

describe("@prism/db config helpers", () => {
  it("treats missing env as unconfigured", () => {
    expect(isSupabaseConfigured({ url: "", anonKey: "" })).toBe(false);
    expect(
      isSupabaseAdminConfigured({ url: "https://x.supabase.co", anonKey: "a", serviceRoleKey: "" }),
    ).toBe(false);
    expect(readSupabaseAdminEnv({})).toBeNull();
  });

  it("reads admin env only when complete", () => {
    const cfg = readSupabaseAdminEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    });
    expect(cfg?.serviceRoleKey).toBe("service");
  });
});

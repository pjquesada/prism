import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";

const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  PRISM_SESSION_BACKEND: process.env.PRISM_SESSION_BACKEND,
  PRISM_ALLOW_MEMORY_SESSIONS: process.env.PRISM_ALLOW_MEMORY_SESSIONS,
  SESSION_SIGNING_SECRET: process.env.SESSION_SIGNING_SECRET,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL.NODE_ENV;
  process.env.PRISM_SESSION_BACKEND = ORIGINAL.PRISM_SESSION_BACKEND;
  process.env.PRISM_ALLOW_MEMORY_SESSIONS = ORIGINAL.PRISM_ALLOW_MEMORY_SESSIONS;
  process.env.SESSION_SIGNING_SECRET = ORIGINAL.SESSION_SIGNING_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIGINAL.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL.SUPABASE_SERVICE_ROLE_KEY;
});

describe("GET /api/health", () => {
  it("returns reachable app with ready memory backend in test mode", async () => {
    process.env.PRISM_SESSION_BACKEND = "memory";
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.phase).toBe("1E");
    expect(body.checks.app.reachable).toBe(true);
    expect(body.checks.sessionBackend.status).toBe("ready");
    expect(body.checks.sessionBackend.transport).toBe("memory");
    expect(body.checks.sessionSchema.compatible).toBe(true);
    expect(typeof body.checks.configuration.sessionSigningSecret).toBe("boolean");
  });

  it("returns 503 with misconfigured session backend in production without secrets", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.PRISM_SESSION_BACKEND;
    delete process.env.PRISM_ALLOW_MEMORY_SESSIONS;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.phase).toBe("1E");
    expect(body.checks.app.reachable).toBe(true);
    expect(body.checks.sessionBackend.status).toBe("misconfigured");
    expect(body.checks.sessionBackend.failClosed).toBe(true);
    expect(body.checks.configuration.serviceRoleKey).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY=/);
    expect(JSON.stringify(body)).not.toMatch(/SESSION_SIGNING_SECRET=./);
    expect(body.phase).not.toBe("1A");
  });
});

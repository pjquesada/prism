import { afterEach, describe, expect, it } from "vitest";

import { getSessionSigningSecret, getSessionTransport, isFailClosedProduction } from "./config";
import { SessionServiceError } from "./errors";
import { createGuestSession } from "./session-service";

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

describe("production fail-closed session config", () => {
  it("fails closed when production secrets are missing", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PRISM_SESSION_BACKEND;
    delete process.env.PRISM_ALLOW_MEMORY_SESSIONS;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(isFailClosedProduction()).toBe(true);
    expect(() => getSessionTransport()).toThrow(SessionServiceError);
    expect(() => getSessionTransport()).toThrow(/Supabase server credentials/);
  });

  it("fails closed when SESSION_SIGNING_SECRET is missing", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PRISM_SESSION_BACKEND;
    delete process.env.PRISM_ALLOW_MEMORY_SESSIONS;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    delete process.env.SESSION_SIGNING_SECRET;
    expect(() => getSessionSigningSecret()).toThrow(/SESSION_SIGNING_SECRET/);
    expect(() => getSessionTransport()).toThrow(/SESSION_SIGNING_SECRET/);
  });

  it("does not silently use memory after a production create failure", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.PRISM_SESSION_BACKEND;
    delete process.env.PRISM_ALLOW_MEMORY_SESSIONS;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(createGuestSession({ role: "controller" })).rejects.toMatchObject({
      code: "server_misconfigured",
    });
  });

  it("uses supabase transport when production env is fully configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.PRISM_SESSION_BACKEND;
    delete process.env.PRISM_ALLOW_MEMORY_SESSIONS;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.SESSION_SIGNING_SECRET = "production-session-signing-secret-min-32b";
    expect(getSessionTransport()).toBe("supabase");
    expect(isFailClosedProduction()).toBe(true);
  });

  it("identifies memory transport only when explicitly allowed", () => {
    process.env.NODE_ENV = "production";
    process.env.PRISM_SESSION_BACKEND = "memory";
    process.env.PRISM_ALLOW_MEMORY_SESSIONS = "true";
    expect(isFailClosedProduction()).toBe(false);
    expect(getSessionTransport()).toBe("memory");
  });
});

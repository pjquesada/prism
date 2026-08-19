import { afterEach, describe, expect, it } from "vitest";

import {
  assessSessionBackendHealth,
  probeDurableSessionSchema,
} from "@/lib/session/backend-health";
import { createFakeAdminClient, createFakeSessionDatabase } from "@/lib/session/fake-admin-client";

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

describe("assessSessionBackendHealth", () => {
  it("reports ready for memory transport in dev/test", async () => {
    process.env.PRISM_SESSION_BACKEND = "memory";
    const report = await assessSessionBackendHealth();
    expect(report.ready).toBe(true);
    expect(report.status).toBe("ready");
    expect(report.transport).toBe("memory");
  });

  it("reports misconfigured when production secrets are missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.PRISM_SESSION_BACKEND;
    delete process.env.PRISM_ALLOW_MEMORY_SESSIONS;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const report = await assessSessionBackendHealth();
    expect(report.ready).toBe(false);
    expect(report.status).toBe("misconfigured");
    expect(report.failClosed).toBe(true);
    expect(report.issues).toContain("missing_supabase_url");
    expect(report.issues).toContain("missing_service_role_key");
  });

  it("reports misconfigured when SESSION_SIGNING_SECRET is missing in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.PRISM_SESSION_BACKEND;
    delete process.env.PRISM_ALLOW_MEMORY_SESSIONS;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    delete process.env.SESSION_SIGNING_SECRET;

    const report = await assessSessionBackendHealth();
    expect(report.ready).toBe(false);
    expect(report.status).toBe("misconfigured");
    expect(report.issues).toContain("missing_signing_secret");
  });

  it("reports schema mismatch when revoked_at column is missing", async () => {
    const client = {
      from: (table: string) => {
        if (table === "guest_sessions") {
          return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
        }
        if (table === "pairing_codes") {
          return {
            select: () => ({
              limit: async () => ({
                data: null,
                error: { message: 'column "revoked_at" does not exist' },
              }),
            }),
          };
        }
        return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
      },
    };

    const report = await probeDurableSessionSchema(client);
    expect(report.ready).toBe(false);
    expect(report.status).toBe("schema_mismatch");
  });

  it("reports schema mismatch when leftover plaintext pairing columns are still exposed", async () => {
    const client = {
      from: (table: string) => {
        if (table === "pairing_codes") {
          return {
            select: (columns: string) => ({
              limit: async () => {
                if (columns.includes("code_hint")) {
                  return { data: [], error: null };
                }
                return { data: [], error: null };
              },
            }),
          };
        }
        return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
      },
    };
    const report = await probeDurableSessionSchema(client);
    expect(report.ready).toBe(false);
    expect(report.status).toBe("schema_mismatch");
    expect(report.schemaCompatible).toBe(false);
  });

  it("reports ready when durable schema probes succeed", async () => {
    const db = createFakeSessionDatabase();
    const client = createFakeAdminClient(db);
    const report = await probeDurableSessionSchema(client);
    expect(report.ready).toBe(true);
    expect(report.status).toBe("ready");
    expect(report.transport).toBe("supabase");
    expect(report.schemaCompatible).toBe(true);
    expect(report.supabaseReachable).toBe(true);
  });
});

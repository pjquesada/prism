import {
  getSessionTransport,
  isFailClosedProduction,
  listSessionConfigIssues,
  resolveSessionTransport,
  type SessionConfigIssue,
  type SessionTransportKind,
} from "@/lib/session/config";
import { SessionServiceError } from "@/lib/session/errors";
import type { SessionAdminClient } from "@/lib/session/supabase-store";
import { createOptionalAdminSupabase } from "@/lib/supabase/admin";

export type SessionBackendHealthStatus =
  "ready" | "misconfigured" | "unavailable" | "schema_mismatch";

export type SessionBackendHealthReport = {
  ready: boolean;
  status: SessionBackendHealthStatus;
  transport: SessionTransportKind;
  failClosed: boolean;
  issues: SessionConfigIssue[];
  detail?: string;
};

const SUPABASE_BACKEND = "supabase" as const;

function classifySchemaProbeError(message: string): SessionBackendHealthStatus | null {
  const lower = message.toLowerCase();
  if (
    lower.includes("code_hint") ||
    (lower.includes("revoked_at") && lower.includes("does not exist")) ||
    (lower.includes("column") && lower.includes("does not exist")) ||
    (lower.includes("relation") && lower.includes("does not exist"))
  ) {
    return "schema_mismatch";
  }
  return null;
}

/** Probe durable Supabase tables expected after the Phase 1D security hotfix. */
export async function probeDurableSessionSchema(
  client: SessionAdminClient,
): Promise<SessionBackendHealthReport> {
  const failClosed = isFailClosedProduction();
  const base = {
    transport: SUPABASE_BACKEND,
    failClosed,
    issues: [] as SessionConfigIssue[],
  };

  const guest = await client.from("guest_sessions").select("id").limit(1);
  if (guest.error) {
    const schema = classifySchemaProbeError(guest.error.message);
    return {
      ready: false,
      status: schema ?? "unavailable",
      ...base,
      detail: "guest_sessions probe failed",
    };
  }

  const pairing = await client.from("pairing_codes").select("code_hash, revoked_at").limit(1);
  if (pairing.error) {
    const schema = classifySchemaProbeError(pairing.error.message);
    return {
      ready: false,
      status: schema ?? "unavailable",
      ...base,
      detail: "pairing_codes probe failed",
    };
  }

  const credentials = await client
    .from("session_credentials")
    .select("secret_hash, revoked_at")
    .limit(1);
  if (credentials.error) {
    const schema = classifySchemaProbeError(credentials.error.message);
    return {
      ready: false,
      status: schema ?? "unavailable",
      ...base,
      detail: "session_credentials probe failed",
    };
  }

  return {
    ready: true,
    status: "ready",
    ...base,
  };
}

export async function assessSessionBackendHealth(): Promise<SessionBackendHealthReport> {
  const failClosed = isFailClosedProduction();
  let transport: SessionTransportKind;
  try {
    transport = resolveSessionTransport();
  } catch (error) {
    if (error instanceof SessionServiceError && error.code === "server_misconfigured") {
      return {
        ready: false,
        status: "misconfigured",
        transport: failClosed ? SUPABASE_BACKEND : "memory",
        failClosed,
        issues: listSessionConfigIssues(),
      };
    }
    return {
      ready: false,
      status: "unavailable",
      transport: failClosed ? SUPABASE_BACKEND : "memory",
      failClosed,
      issues: listSessionConfigIssues(),
    };
  }

  if (transport === "memory") {
    return {
      ready: true,
      status: "ready",
      transport: "memory",
      failClosed,
      issues: [],
    };
  }

  const client = createOptionalAdminSupabase();
  if (!client) {
    return {
      ready: false,
      status: "misconfigured",
      transport: SUPABASE_BACKEND,
      failClosed,
      issues: listSessionConfigIssues(),
    };
  }

  return probeDurableSessionSchema(client as unknown as SessionAdminClient);
}

export { getSessionTransport };

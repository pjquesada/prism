import {
  getSessionConfigurationPresence,
  getSessionTransport,
  isFailClosedProduction,
  listSessionConfigIssues,
  resolveSessionTransport,
  type SessionConfigIssue,
  type SessionConfigurationPresence,
  type SessionTransportKind,
} from "@/lib/session/config";
import { classifySupabaseFailure } from "@/lib/session/db-error";
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
  supabaseReachable: boolean;
  schemaCompatible: boolean;
  configuration: SessionConfigurationPresence;
  issues: SessionConfigIssue[];
  detail?: string;
};

const SUPABASE_BACKEND = "supabase" as const;

function healthBase(): Pick<SessionBackendHealthReport, "failClosed" | "configuration" | "issues"> {
  return {
    failClosed: isFailClosedProduction(),
    configuration: getSessionConfigurationPresence(),
    issues: listSessionConfigIssues(),
  };
}

function classifySchemaProbeError(error: {
  message?: string;
  code?: string;
}): SessionBackendHealthStatus | null {
  const category = classifySupabaseFailure(error);
  if (category === "schema_mismatch") return "schema_mismatch";
  return null;
}

/** Probe durable Supabase tables expected after the Phase 1D security hotfix. */
export async function probeDurableSessionSchema(
  client: SessionAdminClient,
): Promise<SessionBackendHealthReport> {
  const base = {
    transport: SUPABASE_BACKEND,
    ...healthBase(),
  };

  const guest = await client.from("guest_sessions").select("id").limit(1);
  if (guest.error) {
    const schema = classifySchemaProbeError(guest.error);
    return {
      ready: false,
      status: schema ?? "unavailable",
      supabaseReachable: !schema,
      schemaCompatible: false,
      ...base,
      detail: "guest_sessions probe failed",
    };
  }

  const leftover = await client.from("pairing_codes").select("code, code_hint").limit(1);
  if (!leftover.error) {
    return {
      ready: false,
      status: "schema_mismatch",
      supabaseReachable: true,
      schemaCompatible: false,
      ...base,
      detail: "pairing_codes still exposes plaintext columns",
    };
  }

  const pairing = await client.from("pairing_codes").select("code_hash, revoked_at").limit(1);
  if (pairing.error) {
    const schema = classifySchemaProbeError(pairing.error);
    return {
      ready: false,
      status: schema ?? "unavailable",
      supabaseReachable: schema !== "schema_mismatch",
      schemaCompatible: false,
      ...base,
      detail: "pairing_codes probe failed",
    };
  }

  const credentials = await client
    .from("session_credentials")
    .select("secret_hash, revoked_at")
    .limit(1);
  if (credentials.error) {
    const schema = classifySchemaProbeError(credentials.error);
    return {
      ready: false,
      status: schema ?? "unavailable",
      supabaseReachable: schema !== "schema_mismatch",
      schemaCompatible: false,
      ...base,
      detail: "session_credentials probe failed",
    };
  }

  const featureFrames = await client
    .from("session_feature_frames")
    .select("session_id, frame_seq, payload")
    .limit(1);
  if (featureFrames.error) {
    const schema = classifySchemaProbeError(featureFrames.error);
    return {
      ready: false,
      status: schema ?? "unavailable",
      supabaseReachable: schema !== "schema_mismatch",
      schemaCompatible: false,
      ...base,
      detail: "session_feature_frames probe failed",
    };
  }

  return {
    ready: true,
    status: "ready",
    supabaseReachable: true,
    schemaCompatible: true,
    ...base,
  };
}

export async function assessSessionBackendHealth(): Promise<SessionBackendHealthReport> {
  const base = healthBase();
  let transport: SessionTransportKind;
  try {
    transport = resolveSessionTransport();
  } catch (error) {
    const misconfigured =
      error instanceof SessionServiceError &&
      (error.code === "server_misconfigured" || error.code === "configuration_error");
    return {
      ready: false,
      status: misconfigured ? "misconfigured" : "unavailable",
      transport: base.failClosed ? SUPABASE_BACKEND : "memory",
      supabaseReachable: false,
      schemaCompatible: false,
      ...base,
    };
  }

  if (transport === "memory") {
    return {
      ready: true,
      status: "ready",
      transport: "memory",
      supabaseReachable: false,
      schemaCompatible: true,
      ...base,
      issues: [],
    };
  }

  const client = createOptionalAdminSupabase();
  if (!client) {
    return {
      ready: false,
      status: "misconfigured",
      transport: SUPABASE_BACKEND,
      supabaseReachable: false,
      schemaCompatible: false,
      ...base,
    };
  }

  return probeDurableSessionSchema(client as unknown as SessionAdminClient);
}

export { getSessionTransport };

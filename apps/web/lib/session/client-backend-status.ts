import type { SessionBackendHealthStatus } from "@/lib/session/backend-health";
import type { SessionConfigIssue } from "@/lib/session/config";

export type ClientBackendStatus =
  | "checking"
  | "browser_offline"
  | "ready"
  | "misconfigured"
  | "unavailable"
  | "schema_mismatch"
  | "app_unreachable";

export const CLIENT_BACKEND_LABELS: Record<ClientBackendStatus, string> = {
  checking: "Checking session service…",
  browser_offline: "No network connection. Check your internet and try again.",
  ready: "Session service ready",
  misconfigured: "Session service is not configured on the server.",
  unavailable: "Session service is temporarily unavailable.",
  schema_mismatch: "Session database schema is out of date.",
  app_unreachable: "Could not reach the app server.",
};

export function mapHealthStatusToClient(
  status: SessionBackendHealthStatus,
): Exclude<ClientBackendStatus, "checking" | "browser_offline" | "app_unreachable"> {
  switch (status) {
    case "ready":
      return "ready";
    case "misconfigured":
      return "misconfigured";
    case "schema_mismatch":
      return "schema_mismatch";
    case "unavailable":
    default:
      return "unavailable";
  }
}

export function describeConfigIssues(issues: SessionConfigIssue[]): string {
  const labels: Record<SessionConfigIssue, string> = {
    missing_supabase_url: "Supabase URL",
    missing_supabase_anon_key: "Supabase anon key",
    missing_service_role_key: "Supabase service role key",
    missing_signing_secret: "SESSION_SIGNING_SECRET",
    signing_secret_too_short: "SESSION_SIGNING_SECRET (too short)",
  };
  return issues.map((issue) => labels[issue]).join(", ");
}

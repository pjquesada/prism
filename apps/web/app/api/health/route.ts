import { NextResponse } from "next/server";

import { assessSessionBackendHealth } from "@/lib/session/backend-health";
import { isRealtimeConfigured } from "@/lib/session/config";

export async function GET() {
  const sessionBackend = await assessSessionBackendHealth();

  const body = {
    ok: sessionBackend.ready,
    service: "prism-web",
    phase: "1E",
    checks: {
      app: { status: "reachable" as const },
      sessionBackend: {
        ready: sessionBackend.ready,
        status: sessionBackend.status,
        transport: sessionBackend.transport,
        failClosed: sessionBackend.failClosed,
        issues: sessionBackend.issues,
        detail: sessionBackend.detail,
      },
      realtime: { configured: isRealtimeConfigured() },
    },
  };

  return NextResponse.json(body, { status: sessionBackend.ready ? 200 : 503 });
}

import { NextResponse } from "next/server";

import { assessSessionBackendHealth } from "@/lib/session/backend-health";

export async function GET() {
  const sessionBackend = await assessSessionBackendHealth();

  const body = {
    ok: sessionBackend.ready,
    service: "prism-web",
    phase: "1E",
    checks: {
      app: { reachable: true },
      configuration: sessionBackend.configuration,
      supabase: { reachable: sessionBackend.supabaseReachable },
      sessionSchema: { compatible: sessionBackend.schemaCompatible },
      sessionBackend: {
        ready: sessionBackend.ready,
        status: sessionBackend.status,
        transport: sessionBackend.transport,
        failClosed: sessionBackend.failClosed,
      },
    },
  };

  return NextResponse.json(body, { status: sessionBackend.ready ? 200 : 503 });
}

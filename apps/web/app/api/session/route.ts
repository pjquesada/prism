import { SessionServiceError, createGuestSession } from "@/lib/session/memory-store";
import { createSessionBodySchema, jsonError } from "@/lib/session/api-helpers";
import { buildJoinUrl, isRealtimeConfigured } from "@/lib/session/config";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = createSessionBodySchema.parse(await request.json().catch(() => ({})));
    const created = createGuestSession({
      role: body.role,
      displayMode: body.displayMode,
      hostDeviceId: body.hostDeviceId,
    });
    return Response.json({
      sessionId: created.snapshot.session.id,
      snapshot: created.snapshot,
      credential: created.credential,
      pairingCode: created.pairingCode,
      pairingExpiresAt: created.pairingExpiresAt,
      joinUrl: buildJoinUrl(created.pairingCode),
      transport: isRealtimeConfigured() ? "supabase" : "memory",
    });
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("invalid_request", "Could not create session.", 400);
  }
}

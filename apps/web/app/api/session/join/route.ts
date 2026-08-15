import { SessionServiceError, joinWithPairingCode } from "@/lib/session/memory-store";
import {
  getClientIp,
  joinSessionBodySchema,
  jsonError,
  parseJoinCode,
} from "@/lib/session/api-helpers";
import { isRealtimeConfigured } from "@/lib/session/config";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = joinSessionBodySchema.parse(await request.json());
    const code = parseJoinCode(body.code);
    const joined = joinWithPairingCode({
      code,
      role: body.role,
      deviceId: body.deviceId,
      label: body.label ?? null,
      ip: getClientIp(request),
    });
    return Response.json({
      sessionId: joined.snapshot.session.id,
      snapshot: joined.snapshot,
      credential: joined.credential,
      transport: isRealtimeConfigured() ? "supabase" : "memory",
    });
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }
}

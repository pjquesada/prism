import {
  SessionServiceError,
  joinWithPairingCode,
  resolveSessionTransport,
} from "@/lib/session/session-service";
import {
  getClientIp,
  joinSessionBodySchema,
  jsonError,
  jsonWithGuestCredential,
  parseJoinCode,
} from "@/lib/session/api-helpers";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = joinSessionBodySchema.parse(await request.json());
    const code = parseJoinCode(body.code);
    const joined = await joinWithPairingCode({
      code,
      role: body.role,
      deviceId: body.deviceId,
      label: body.label ?? null,
      ip: getClientIp(request),
    });
    return jsonWithGuestCredential(
      {
        sessionId: joined.snapshot.session.id,
        snapshot: joined.snapshot,
        credential: joined.credential,
        transport: resolveSessionTransport(),
      },
      joined.credential,
    );
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }
}

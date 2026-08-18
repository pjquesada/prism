import {
  SessionServiceError,
  createGuestSession,
  resolveSessionTransport,
  toPublicIdentity,
} from "@/lib/session/session-service";
import {
  assertMutatingSameOrigin,
  createSessionBodySchema,
  jsonError,
  jsonWithGuestCredential,
} from "@/lib/session/api-helpers";
import { buildJoinUrl } from "@/lib/session/config";

export async function POST(request: Request): Promise<Response> {
  try {
    assertMutatingSameOrigin(request);
    const body = createSessionBodySchema.parse(await request.json().catch(() => ({})));
    const created = await createGuestSession({
      role: body.role,
      displayMode: body.displayMode,
      hostDeviceId: body.hostDeviceId,
    });
    return jsonWithGuestCredential(
      {
        sessionId: created.snapshot.session.id,
        snapshot: created.snapshot,
        credential: toPublicIdentity(created.credential),
        pairingCode: created.pairingCode,
        pairingExpiresAt: created.pairingExpiresAt,
        joinUrl: buildJoinUrl(created.pairingCode),
        transport: resolveSessionTransport(),
      },
      created.credential,
    );
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("invalid_request", "Could not create session.", 400);
  }
}

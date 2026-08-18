import {
  SessionServiceError,
  authorizeCredential,
  getSnapshotForCredential,
  heartbeat,
} from "@/lib/session/session-service";
import {
  assertMutatingSameOrigin,
  getGuestTokenFromRequest,
  jsonError,
  sessionIdParamSchema,
} from "@/lib/session/api-helpers";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const sessionId = sessionIdParamSchema.parse((await context.params).sessionId);
    const token = getGuestTokenFromRequest(request, sessionId);
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    const cred = await authorizeCredential(token);
    if (cred.sessionId !== sessionId) {
      return jsonError("unauthorized", "Unauthorized.", 401);
    }
    const snapshot = await getSnapshotForCredential(token);
    return Response.json({
      snapshot,
      device: {
        deviceId: cred.deviceId,
        role: cred.role,
        sessionId: cred.sessionId,
        expiresAt: cred.expiresAt,
      },
    });
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("unauthorized", "Unauthorized.", 401);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertMutatingSameOrigin(request);
    const sessionId = sessionIdParamSchema.parse((await context.params).sessionId);
    const token = getGuestTokenFromRequest(request, sessionId);
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    const snapshot = await heartbeat(token);
    if (snapshot.session.id !== sessionId) {
      return jsonError("unauthorized", "Unauthorized.", 401);
    }
    return Response.json({ snapshot });
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("unauthorized", "Unauthorized.", 401);
  }
}

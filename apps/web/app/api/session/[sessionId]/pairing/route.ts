import { SessionServiceError, rotatePairingCode } from "@/lib/session/session-service";
import {
  assertMutatingSameOrigin,
  getClientIp,
  getGuestTokenFromRequest,
  jsonError,
  sessionIdParamSchema,
} from "@/lib/session/api-helpers";
import { buildJoinUrl } from "@/lib/session/config";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertMutatingSameOrigin(request);
    const sessionId = sessionIdParamSchema.parse((await context.params).sessionId);
    const token = getGuestTokenFromRequest(request, sessionId);
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    const rotated = await rotatePairingCode(token, getClientIp(request));
    return Response.json({
      pairingCode: rotated.pairingCode,
      pairingExpiresAt: rotated.pairingExpiresAt,
      joinUrl: buildJoinUrl(rotated.pairingCode),
    });
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("unauthorized", "Unauthorized.", 401);
  }
}

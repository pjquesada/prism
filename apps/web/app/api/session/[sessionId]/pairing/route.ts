import { SessionServiceError, rotatePairingCode } from "@/lib/session/memory-store";
import { getBearerToken, jsonError } from "@/lib/session/api-helpers";
import { buildJoinUrl } from "@/lib/session/config";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    const token = getBearerToken(request);
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    const deviceId = token.split(".")[1];
    if (!deviceId || !token.startsWith(`${sessionId}.`)) {
      return jsonError("unauthorized", "Unauthorized.", 401);
    }
    const rotated = rotatePairingCode(sessionId, deviceId);
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

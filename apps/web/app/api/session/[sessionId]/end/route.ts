import { SessionServiceError, endSession } from "@/lib/session/session-service";
import {
  assertMutatingSameOrigin,
  getGuestTokenFromRequest,
  guestCredentialClearCookieHeader,
  jsonError,
  sessionIdParamSchema,
} from "@/lib/session/api-helpers";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertMutatingSameOrigin(request);
    const sessionId = sessionIdParamSchema.parse((await context.params).sessionId);
    const token = getGuestTokenFromRequest(request, sessionId);
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    await endSession(token);
    const response = Response.json({ ok: true });
    response.headers.append("Set-Cookie", guestCredentialClearCookieHeader(sessionId));
    return response;
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("unauthorized", "Unauthorized.", 401);
  }
}

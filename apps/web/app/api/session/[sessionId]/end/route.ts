import { SessionServiceError, endSession } from "@/lib/session/session-service";
import {
  getGuestTokenFromRequest,
  guestCredentialClearCookieHeader,
  jsonError,
} from "@/lib/session/api-helpers";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    const token = getGuestTokenFromRequest(request);
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    if (!token.startsWith(`${sessionId}.`)) {
      return jsonError("unauthorized", "Unauthorized.", 401);
    }
    await endSession(token);
    const response = Response.json({ ok: true });
    response.headers.append("Set-Cookie", guestCredentialClearCookieHeader());
    return response;
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("unauthorized", "Unauthorized.", 401);
  }
}

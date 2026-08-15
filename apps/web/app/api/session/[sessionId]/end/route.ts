import { SessionServiceError, endSession } from "@/lib/session/memory-store";
import { getBearerToken, jsonError } from "@/lib/session/api-helpers";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    const token = getBearerToken(request);
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    if (!token.startsWith(`${sessionId}.`)) {
      return jsonError("unauthorized", "Unauthorized.", 401);
    }
    endSession(token);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("unauthorized", "Unauthorized.", 401);
  }
}

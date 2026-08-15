import { SessionServiceError, handoffController } from "@/lib/session/memory-store";
import { getBearerToken, handoffBodySchema, jsonError } from "@/lib/session/api-helpers";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    const token = getBearerToken(request);
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    const body = handoffBodySchema.parse(await request.json());
    const snapshot = handoffController(token, body.targetDeviceId);
    if (snapshot.session.id !== sessionId) {
      return jsonError("unauthorized", "Unauthorized.", 401);
    }
    return Response.json({ snapshot });
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("invalid_request", "Could not hand off controller.", 400);
  }
}

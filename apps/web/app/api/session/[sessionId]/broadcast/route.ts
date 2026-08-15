import { MAX_SESSION_EVENT_BYTES, sessionMessageSchema } from "@prism/contracts";
import { assertPayloadSize } from "@prism/sync-engine";

import { SessionServiceError, publishAuthorizedMessage } from "@/lib/session/memory-store";
import {
  assertSafeSessionPayload,
  broadcastBodySchema,
  getBearerToken,
  jsonError,
} from "@/lib/session/api-helpers";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    const token = getBearerToken(request);
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    const raw = await request.json();
    assertPayloadSize(raw, MAX_SESSION_EVENT_BYTES);
    assertSafeSessionPayload(raw);
    const body = broadcastBodySchema.parse(raw);
    const message = sessionMessageSchema.parse(body.message);
    if (message.sessionId !== sessionId) {
      return jsonError("unauthorized", "Unauthorized.", 401);
    }
    const stamped = publishAuthorizedMessage(token, message);
    return Response.json({ message: stamped });
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    if (error instanceof Error && error.message.startsWith("payload_too_large")) {
      return jsonError("payload_too_large", "Event payload too large.", 413);
    }
    if (error instanceof Error && error.message.startsWith("forbidden_payload")) {
      return jsonError("forbidden_payload", "Payload contains forbidden fields.", 400);
    }
    return jsonError("invalid_request", "Invalid session event.", 400);
  }
}

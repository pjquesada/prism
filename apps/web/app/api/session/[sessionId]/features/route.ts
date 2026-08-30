import {
  featureFallbackQuerySchema,
  featurePublishBodySchema,
  featurePublishResponseSchema,
} from "@prism/contracts";

import { getSessionFeaturesAfter, publishSessionFeatures } from "@/lib/session/feature-transport";
import { SessionServiceError } from "@/lib/session/session-service";
import {
  assertMutatingSameOrigin,
  assertSafeSessionPayload,
  getGuestTokenFromRequest,
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
    const raw = await request.json();
    assertSafeSessionPayload(raw);
    const body = featurePublishBodySchema.parse(raw);
    const result = await publishSessionFeatures(token, body.envelope);
    return Response.json(featurePublishResponseSchema.parse(result));
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    if (error instanceof Error && error.message.startsWith("forbidden_payload")) {
      return jsonError("forbidden_payload", "Payload contains forbidden fields.", 400);
    }
    return jsonError("invalid_request", "Invalid feature publication.", 400);
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const sessionId = sessionIdParamSchema.parse((await context.params).sessionId);
    const token = getGuestTokenFromRequest(request, sessionId);
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    const url = new URL(request.url);
    const query = featureFallbackQuerySchema.parse({
      afterSeq: url.searchParams.get("afterSeq") ?? undefined,
    });
    const frame = await getSessionFeaturesAfter(token, query.afterSeq);
    if (!frame) {
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json(
      {
        envelope: frame.envelope,
        frameSeq: frame.frameSeq,
        timestampMs: frame.timestampMs,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("invalid_request", "Invalid feature read.", 400);
  }
}

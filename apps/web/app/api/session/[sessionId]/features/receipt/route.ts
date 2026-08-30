import { featureReceiptBodySchema, featureReceiptResponseSchema } from "@prism/contracts";

import { recordFeatureReceipt } from "@/lib/session/feature-transport";
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
    const body = featureReceiptBodySchema.parse(raw);
    const result = await recordFeatureReceipt(token, body);
    return Response.json(featureReceiptResponseSchema.parse(result));
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("invalid_request", "Invalid feature receipt.", 400);
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const sessionId = sessionIdParamSchema.parse((await context.params).sessionId);
    const token = getGuestTokenFromRequest(request, sessionId);
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    const { getLatestFeatureReceipt } = await import("@/lib/session/feature-transport");
    const receipt = await getLatestFeatureReceipt(token);
    if (!receipt) {
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json(
      {
        frameSeq: receipt.frameSeq,
        receivedAtMs: receipt.receivedAtMs,
        transport: receipt.transport,
        deviceId: receipt.deviceId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("invalid_request", "Invalid feature receipt read.", 400);
  }
}

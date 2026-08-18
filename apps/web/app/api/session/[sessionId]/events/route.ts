import {
  SessionServiceError,
  authorizeCredential,
  getSnapshotForCredential,
  subscribeSession,
} from "@/lib/session/session-service";
import { getGuestTokenFromRequest, jsonError } from "@/lib/session/api-helpers";
import { isDurableSessionBackend } from "@/lib/session/config";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * Memory-transport realtime: Server-Sent Events fanout for local/dev/CI.
 * Durable Supabase sessions rely on snapshot polling (cross-instance safe).
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    const url = new URL(request.url);
    const token = getGuestTokenFromRequest(request) ?? url.searchParams.get("token");
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    const cred = await authorizeCredential(token);
    if (cred.sessionId !== sessionId) {
      return jsonError("unauthorized", "Unauthorized.", 401);
    }

    if (isDurableSessionBackend()) {
      const snapshot = await getSnapshotForCredential(token);
      return Response.json({
        snapshot,
        transport: "supabase",
        hint: "Use snapshot polling; SSE fanout is memory-only.",
      });
    }

    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        void getSnapshotForCredential(token)
          .then((snapshot) => {
            send("snapshot", {
              type: "session.snapshot",
              seq: snapshot.session.seq,
              sentAt: new Date().toISOString(),
              sessionId,
              deviceId: cred.deviceId,
              payload: snapshot,
            });
          })
          .catch(() => {
            controller.close();
          });

        unsubscribe = subscribeSession(sessionId, (message) => {
          send("message", message);
        });

        heartbeatTimer = setInterval(() => {
          send("ping", { t: Date.now() });
        }, 15_000);

        request.signal.addEventListener("abort", () => {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
      cancel() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        unsubscribe();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof SessionServiceError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError("unauthorized", "Unauthorized.", 401);
  }
}

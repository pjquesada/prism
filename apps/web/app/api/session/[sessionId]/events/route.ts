import {
  SessionServiceError,
  authorizeCredential,
  getSnapshotForCredential,
  subscribeSession,
} from "@/lib/session/memory-store";
import { getBearerToken, jsonError } from "@/lib/session/api-helpers";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * Memory-transport realtime: Server-Sent Events fanout for local/dev/CI
 * when Supabase Realtime is not configured.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    const url = new URL(request.url);
    const token = getBearerToken(request) ?? url.searchParams.get("token");
    if (!token) return jsonError("unauthorized", "Unauthorized.", 401);
    const cred = authorizeCredential(token);
    if (cred.sessionId !== sessionId) {
      return jsonError("unauthorized", "Unauthorized.", 401);
    }

    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const snapshot = getSnapshotForCredential(token);
          send("snapshot", {
            type: "session.snapshot",
            seq: snapshot.session.seq,
            sentAt: new Date().toISOString(),
            sessionId,
            deviceId: cred.deviceId,
            payload: snapshot,
          });
        } catch {
          controller.close();
          return;
        }

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

import { describe, expect, it, vi } from "vitest";

import { SessionClient } from "./session-client";

describe("SessionClient feature publication", () => {
  it("does not strand a coalesced envelope behind an in-flight publish", async () => {
    const responses: number[] = [];
    let resolveFirst: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/features") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { envelope: { frameSeq: number } };
          return new Promise<Response>((resolve) => {
            if (body.envelope.frameSeq === 1) {
              resolveFirst = () =>
                resolve(
                  new Response(
                    JSON.stringify({ accepted: true, frameSeq: 1, durableFallback: "stored" }),
                    { status: 200 },
                  ),
                );
              return;
            }
            responses.push(body.envelope.frameSeq);
            resolve(
              new Response(
                JSON.stringify({
                  accepted: true,
                  frameSeq: body.envelope.frameSeq,
                  durableFallback: "stored",
                }),
                { status: 200 },
              ),
            );
          });
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      }),
    );

    const client = new SessionClient({ onState: () => undefined });
    (
      client as unknown as { identity: { sessionId: string; deviceId: string; role: string } }
    ).identity = {
      sessionId: "11111111-1111-4111-8111-111111111111",
      deviceId: "controller-1",
      role: "controller",
    };

    const first = client.publishFeatures({
      frameSeq: 1,
      timestampMs: Date.now(),
      rms: 0.1,
      energy: 0.2,
      bass: 0.1,
      mid: 0.1,
      high: 0.1,
      levels: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      onset: false,
      beatStrength: 0,
      centroid: 0.1,
    });
    const second = client.publishFeatures({
      frameSeq: 2,
      timestampMs: Date.now(),
      rms: 0.2,
      energy: 0.3,
      bass: 0.1,
      mid: 0.1,
      high: 0.1,
      levels: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
      onset: false,
      beatStrength: 0,
      centroid: 0.2,
    });
    resolveFirst?.();
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(responses).toContain(2);
    client.dispose();
    vi.unstubAllGlobals();
  });

  it("starts with idle realtime channel state", () => {
    const client = new SessionClient({ onState: () => undefined });
    expect(client.getRealtimeChannelState()).toBe("idle");
    client.dispose();
  });
});

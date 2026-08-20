import { describe, expect, it, vi } from "vitest";

import { SessionClient } from "./session-client";

describe("SessionClient restore errors", () => {
  it("terminates connecting with a retryable error status on restore timeout", async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const client = new SessionClient({
      onState: (state) => {
        states.push(state.connection);
      },
    });

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const restore = client.restoreWithCookie("11111111-1111-4111-8111-111111111111");
    const pending = restore.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(16_000);
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("restore_timeout");
    expect(states).toContain("error");
    expect(states.at(-1)).not.toBe("connecting");
    client.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not put credentials into request URLs", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        urls.push(String(input));
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 }),
        );
      }),
    );
    const client = new SessionClient({ onState: () => undefined });
    await expect(
      client.restoreWithCookie("11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow();
    expect(urls.join(" ")).not.toMatch(/token=/);
    expect(urls.join(" ")).not.toMatch(/credential=/);
    client.dispose();
    vi.unstubAllGlobals();
  });
});

describe("SessionClient snapshot polling", () => {
  it("skips polling while realtime is healthy", async () => {
    const { shouldPollSnapshot, REALTIME_HEALTHY_MS } = await import("./session-client");
    expect(shouldPollSnapshot(0, 1_000)).toBe(true);
    expect(shouldPollSnapshot(1_000, 1_000 + REALTIME_HEALTHY_MS - 1)).toBe(false);
    expect(shouldPollSnapshot(1_000, 1_000 + REALTIME_HEALTHY_MS)).toBe(true);
  });
});

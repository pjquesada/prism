import { afterEach, describe, expect, it } from "vitest";

import { isLiveListenEnabled } from "@/lib/live-listen-enabled";

const ORIGINAL = process.env.NEXT_PUBLIC_ENABLE_LIVE_LISTEN;

describe("isLiveListenEnabled", () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_ENABLE_LIVE_LISTEN;
    else process.env.NEXT_PUBLIC_ENABLE_LIVE_LISTEN = ORIGINAL;
  });

  it("is enabled unless explicitly set to false", () => {
    delete process.env.NEXT_PUBLIC_ENABLE_LIVE_LISTEN;
    expect(isLiveListenEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_ENABLE_LIVE_LISTEN = "false";
    expect(isLiveListenEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_ENABLE_LIVE_LISTEN = "true";
    expect(isLiveListenEnabled()).toBe(true);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireAnimationLoop,
  getPrismPerfSnapshot,
  noteDroppedOrStaleFrame,
  noteFeatureMessage,
  noteRenderFrame,
  registerPerfResourceSource,
  resetPrismPerfForTests,
} from "./perf-instrumentation.js";

describe("perf instrumentation", () => {
  afterEach(() => {
    resetPrismPerfForTests();
    registerPerfResourceSource(() => ({
      audioContexts: 0,
      mediaSources: 0,
      animationLoops: 0,
      realtimeSubscriptions: 0,
    }));
  });

  it("counts a single animation loop and merges resource snapshots", () => {
    resetPrismPerfForTests();
    registerPerfResourceSource(() => ({
      audioContexts: 1,
      mediaSources: 1,
      animationLoops: 1,
      realtimeSubscriptions: 1,
    }));
    const release = acquireAnimationLoop();
    noteRenderFrame(0);
    noteRenderFrame(1_000);
    noteFeatureMessage(0);
    noteFeatureMessage(1_000);
    noteDroppedOrStaleFrame();
    const snapshot = getPrismPerfSnapshot();
    expect(snapshot.animationLoops).toBe(2);
    expect(snapshot.audioContexts).toBe(1);
    expect(snapshot.mediaSources).toBe(1);
    expect(snapshot.realtimeSubscriptions).toBe(1);
    expect(snapshot.droppedOrStaleFrames).toBe(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/pcm|fft|pairing|secret/i);
    release();
    expect(getPrismPerfSnapshot().animationLoops).toBe(1);
  });
});

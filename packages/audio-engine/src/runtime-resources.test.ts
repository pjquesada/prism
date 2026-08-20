import { describe, expect, it } from "vitest";

import {
  acquireResource,
  getResourceCounts,
  resetResourceCountsForTests,
} from "./runtime-resources.js";

describe("runtime resource counters", () => {
  it("tracks acquire/release without leaking after dispose", () => {
    resetResourceCountsForTests();
    const releaseContext = acquireResource("audioContexts");
    const releaseSource = acquireResource("mediaSources");
    expect(getResourceCounts().audioContexts).toBe(1);
    expect(getResourceCounts().mediaSources).toBe(1);
    releaseContext();
    releaseContext();
    releaseSource();
    expect(getResourceCounts().audioContexts).toBe(0);
    expect(getResourceCounts().mediaSources).toBe(0);
  });
});

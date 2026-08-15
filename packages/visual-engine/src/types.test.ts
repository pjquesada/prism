import { afterEach, describe, expect, it, vi } from "vitest";

import { isWebGLAvailable, readPrefersReducedMotion } from "./types.js";

describe("visual-engine helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports webgl availability without throwing outside a browser canvas mock", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(isWebGLAvailable()).toBe(false);
  });

  it("detects a mocked webgl context as available", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );
    expect(isWebGLAvailable()).toBe(true);
  });

  it("reads reduced-motion preference safely", () => {
    expect(typeof readPrefersReducedMotion()).toBe("boolean");
  });
});

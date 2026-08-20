import { describe, expect, it, vi } from "vitest";
import { OrthographicCamera, PerspectiveCamera } from "three";

import { applyCameraMode } from "./types.js";
import {
  applyVisualizerResize,
  computeBackingStoreSize,
  fillCanvasElement,
  measureCssSize,
  observeElementSize,
} from "./resize.js";
import { DISPLAY_VIEWPORTS, computeDisplayStageSize, stageFillsViewport } from "./stage-layout.js";

describe("visualizer backing store resize", () => {
  it("uses CSS size × capped DPR for canvas backing pixels", () => {
    const size = computeBackingStoreSize(1920, 1080, 3, 2);
    expect(size.cssWidth).toBe(1920);
    expect(size.cssHeight).toBe(1080);
    expect(size.dpr).toBe(2);
    expect(size.backingWidth).toBe(3840);
    expect(size.backingHeight).toBe(2160);
    expect(size.aspect).toBeCloseTo(16 / 9);
  });

  it("updates Three.js renderer size, camera aspect, and projection", () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 200);
    const setSize = vi.fn();
    const setPixelRatio = vi.fn();
    const canvas = {
      width: 300,
      height: 150,
      style: { width: "", height: "", position: "", inset: "", display: "" },
    };
    const size = applyVisualizerResize({
      renderer: { setSize, setPixelRatio, domElement: canvas },
      camera,
      cameraMode: "perspective",
      cssWidth: 800,
      cssHeight: 450,
      devicePixelRatio: 2,
      dprCap: 2,
    });
    expect(setPixelRatio).toHaveBeenCalledWith(2);
    expect(setSize).toHaveBeenCalledWith(800, 450, false);
    expect(camera.aspect).toBeCloseTo(800 / 450);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(900);
    expect(canvas.style.width).toBe("100%");
    expect(canvas.style.height).toBe("100%");
    expect(size.backingWidth).toBe(1600);
  });

  it("fills a canvas element without stretching a smaller buffer", () => {
    const canvas = {
      width: 10,
      height: 10,
      style: { width: "", height: "", position: "", inset: "", display: "" },
    };
    fillCanvasElement(canvas, computeBackingStoreSize(390, 700, 2, 2));
    expect(canvas.width).toBe(780);
    expect(canvas.height).toBe(1400);
    expect(canvas.style.position).toBe("absolute");
    expect(canvas.style.inset).toBe("0");
  });

  it("floors zero dimensions so cameras stay valid", () => {
    expect(measureCssSize(0, 0)).toEqual({ width: 1, height: 1 });
    const ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    applyCameraMode(ortho, "orthographic", 1, 1);
    expect(Number.isFinite(ortho.left)).toBe(true);
  });
});

describe("display stage layout viewports", () => {
  it("fills mobile portrait, landscape, desktop, and 16:9 TV stages", () => {
    const cases: Array<{ name: keyof typeof DISPLAY_VIEWPORTS; chrome: number }> = [
      { name: "mobilePortrait", chrome: 48 },
      { name: "mobileLandscape", chrome: 40 },
      { name: "desktop", chrome: 56 },
      { name: "tv16x9", chrome: 48 },
    ];
    for (const entry of cases) {
      const viewport = DISPLAY_VIEWPORTS[entry.name];
      const stage = computeDisplayStageSize({
        viewport,
        chromeHeight: entry.chrome,
        safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      expect(stage.width).toBe(viewport.width);
      expect(stage.height).toBe(viewport.height - entry.chrome);
      expect(stage.height).toBeGreaterThan(viewport.height * 0.5);
      expect(stageFillsViewport(stage, viewport, entry.chrome)).toBe(true);
    }
  });

  it("does not leave a shallow 16rem strip on a tall desktop container", () => {
    const viewport = DISPLAY_VIEWPORTS.desktop;
    const stage = computeDisplayStageSize({ viewport, chromeHeight: 64 });
    const sixteenRem = 16 * 16;
    expect(stage.height).toBeGreaterThan(sixteenRem * 2);
    expect(stage.height).toBe(viewport.height - 64);
  });
});

describe("resize observers", () => {
  it("disconnects when the disposer runs", () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
        disconnect = disconnect;
        unobserve = vi.fn();
      },
    );
    const el = document.createElement("div");
    const stop = observeElementSize(el, () => undefined);
    expect(observe).toHaveBeenCalledWith(el);
    stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

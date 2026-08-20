import type { Camera, PerspectiveCamera, WebGLRenderer } from "three";

import { applyCameraMode, type VisualizerCameraMode } from "./types.js";

export const MAX_VISUALIZER_DPR = 2;

export type BackingStoreSize = {
  cssWidth: number;
  cssHeight: number;
  backingWidth: number;
  backingHeight: number;
  dpr: number;
  aspect: number;
};

export type RendererResizeTarget = {
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
  setPixelRatio: (ratio: number) => void;
  getPixelRatio?: () => number;
  domElement?: Pick<HTMLCanvasElement, "width" | "height" | "style">;
};

/**
 * CSS pixel size of a container, with a 1×1 floor so cameras never see 0 aspect.
 */
export function measureCssSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/**
 * Canvas backing resolution = CSS size × capped device pixel ratio.
 * Does not stretch a small buffer with CSS.
 */
export function computeBackingStoreSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  dprCap = MAX_VISUALIZER_DPR,
): BackingStoreSize {
  const { width, height } = measureCssSize(cssWidth, cssHeight);
  const raw = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const dpr = Math.min(Math.max(raw, 0.5), dprCap);
  return {
    cssWidth: width,
    cssHeight: height,
    backingWidth: Math.max(1, Math.round(width * dpr)),
    backingHeight: Math.max(1, Math.round(height * dpr)),
    dpr,
    aspect: width / height,
  };
}

export function fillCanvasElement(
  canvas: Pick<HTMLCanvasElement, "width" | "height" | "style">,
  size: BackingStoreSize,
): void {
  canvas.width = size.backingWidth;
  canvas.height = size.backingHeight;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.display = "block";
}

/**
 * Update Three.js drawing buffer, camera aspect, and projection after a container resize.
 */
export function applyVisualizerResize(input: {
  renderer: RendererResizeTarget | WebGLRenderer;
  camera: Camera;
  cameraMode: VisualizerCameraMode;
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
  dprCap?: number;
}): BackingStoreSize {
  const size = computeBackingStoreSize(
    input.cssWidth,
    input.cssHeight,
    input.devicePixelRatio,
    input.dprCap ?? MAX_VISUALIZER_DPR,
  );
  input.renderer.setPixelRatio(size.dpr);
  input.renderer.setSize(size.cssWidth, size.cssHeight, false);
  if (input.renderer.domElement) {
    fillCanvasElement(input.renderer.domElement, size);
  }
  applyCameraMode(input.camera, input.cameraMode, size.cssWidth, size.cssHeight);
  const persp = input.camera as PerspectiveCamera;
  if ("isPerspectiveCamera" in persp && persp.isPerspectiveCamera) {
    persp.aspect = size.aspect;
    persp.updateProjectionMatrix();
  }
  return size;
}

export const VISUALIZER_HOST_FILL_STYLE = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "block",
} as const;

export function observeElementSize(
  element: Element,
  onSize: (width: number, height: number) => void,
): () => void {
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    onSize(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(element);
  return () => observer.disconnect();
}

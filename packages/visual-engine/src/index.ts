export {
  isWebGLAvailable,
  readPrefersReducedMotion,
  applyCameraMode,
  clearScenePlugins,
  type VisualizerCameraMode,
  type VisualizerInstance,
  type VisualizerMountContext,
  type VisualizerPlugin,
  type VisualizerProps,
} from "./types.js";
export {
  AdaptiveQualityManager,
  QUALITY_CAPS,
  clampDpr,
  qualityCaps,
  type AdaptiveQualityCaps,
  type AdaptiveQualityOptions,
} from "./adaptive-quality.js";
export {
  createFallbackFeatures,
  VisualizerCanvas,
  type VisualizerCanvasProps,
} from "./visualizer-canvas.js";
export {
  acquireAnimationLoop,
  getPrismPerfSnapshot,
  isPrismPerfEnabled,
  noteDroppedOrStaleFrame,
  noteFeatureMessage,
  noteRenderFrame,
  registerPerfResourceSource,
  resetPrismPerfForTests,
  type PrismPerfSnapshot,
  type PrismResourceSnapshot,
} from "./perf-instrumentation.js";
export {
  applyVisualizerResize,
  computeBackingStoreSize,
  fillCanvasElement,
  measureCssSize,
  observeElementSize,
  MAX_VISUALIZER_DPR,
  VISUALIZER_HOST_FILL_STYLE,
  type BackingStoreSize,
  type RendererResizeTarget,
} from "./resize.js";
export {
  computeDisplayStageSize,
  DISPLAY_VIEWPORTS,
  stageFillsViewport,
  type DisplayViewportName,
  type SafeAreaInsets,
  type ViewportBox,
} from "./stage-layout.js";

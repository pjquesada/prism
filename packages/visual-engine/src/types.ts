import type { AudioFeatureFrame, QualityTier, VisualizerId } from "@prism/contracts";
import type { Camera, Scene, WebGLRenderer } from "three";
import type { ZodType } from "zod";

export type VisualizerMountContext = {
  scene: Scene;
  camera: Camera;
  renderer: WebGLRenderer;
  width: number;
  height: number;
};

export type VisualizerProps = {
  features: AudioFeatureFrame;
  preset: { params: Record<string, unknown> };
  quality: QualityTier;
  reducedMotion: boolean;
  albumArtUrl?: string | null;
};

export type VisualizerInstance = {
  update(props: VisualizerProps): void;
  setQuality(tier: QualityTier): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

export type VisualizerPlugin = {
  id: VisualizerId;
  label: string;
  description: string;
  defaultParams: Record<string, unknown>;
  paramsSchema: ZodType;
  supportsAlbumArt: boolean;
  supportsDreamscapeKeyframes: boolean;
  mount(ctx: VisualizerMountContext): VisualizerInstance;
};

export function isWebGLAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

export function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

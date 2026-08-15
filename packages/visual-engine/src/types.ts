import type { AudioFeatureFrame, QualityTier, VisualizerId } from "@prism/contracts";
import type { Camera, OrthographicCamera, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { ZodType } from "zod";

export type VisualizerCameraMode = "orthographic" | "perspective";

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
  preferredCamera?: VisualizerCameraMode;
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

/** Clear plugin-owned scene graph children without disposing the renderer. */
export function clearScenePlugins(scene: Scene): void {
  const keep = new Set(["AmbientLight", "DirectionalLight", "HemisphereLight"]);
  const toRemove = [...scene.children].filter((child) => {
    // Keep R3F-managed color/fog attachments; remove previous plugin roots.
    if (keep.has(child.type)) return false;
    return true;
  });
  for (const child of toRemove) {
    scene.remove(child);
  }
}

export function applyCameraMode(
  camera: Camera,
  mode: VisualizerCameraMode,
  width: number,
  height: number,
): void {
  const aspect = Math.max(width, 1) / Math.max(height, 1);
  if (mode === "perspective") {
    const persp = camera as PerspectiveCamera;
    if ("isPerspectiveCamera" in persp && persp.isPerspectiveCamera) {
      persp.fov = 50;
      persp.near = 0.1;
      persp.far = 200;
      persp.position.set(0, 0, 8);
      persp.lookAt(0, 0, 0);
      persp.aspect = aspect;
      persp.updateProjectionMatrix();
      return;
    }
  }

  const ortho = camera as OrthographicCamera;
  if ("isOrthographicCamera" in ortho && ortho.isOrthographicCamera) {
    const frustum = 6;
    ortho.left = -frustum * aspect;
    ortho.right = frustum * aspect;
    ortho.top = frustum;
    ortho.bottom = -frustum;
    ortho.near = 0.1;
    ortho.far = 100;
    ortho.position.set(0, 0, 10);
    ortho.zoom = 1;
    ortho.lookAt(0, 0, 0);
    ortho.updateProjectionMatrix();
  }
}

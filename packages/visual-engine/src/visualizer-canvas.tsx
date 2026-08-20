"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type { AudioFeatureFrame, QualityTier } from "@prism/contracts";
import { createSilentFeatureFrame } from "@prism/contracts";
import type { Camera, Scene, WebGLRenderer } from "three";

import {
  AdaptiveQualityManager,
  clampDpr,
  qualityCaps,
  type AdaptiveQualityManager as AdaptiveQualityManagerType,
} from "./adaptive-quality.js";
import { applyVisualizerResize, observeElementSize, VISUALIZER_HOST_FILL_STYLE } from "./resize.js";
import {
  acquireAnimationLoop,
  noteRenderFrame,
} from "./perf-instrumentation.js";
import {
  applyCameraMode,
  clearScenePlugins,
  isWebGLAvailable,
  readPrefersReducedMotion,
  type VisualizerPlugin,
} from "./types.js";

export type VisualizerCanvasProps = {
  plugin: VisualizerPlugin;
  /** Prefer a ref for high-frequency frames to avoid React render thrash. */
  featuresRef: RefObject<AudioFeatureFrame>;
  /** Optional per-RAF resolver so displays can interpolate without a second loop. */
  resolveFeatures?: (nowMs: number) => AudioFeatureFrame;
  quality?: QualityTier;
  /** When true, AdaptiveQualityManager may step tiers from frame timings. */
  adaptiveQuality?: boolean;
  className?: string;
  style?: CSSProperties;
  params?: Record<string, unknown>;
  albumArtUrl?: string | null;
  fallback?: ReactNode;
  onQualityChange?: (tier: QualityTier) => void;
};

type HostHandles = {
  scene: Scene;
  camera: Camera;
  renderer: WebGLRenderer;
  width: number;
  height: number;
};

function PluginRuntime({
  plugin,
  featuresRef,
  resolveFeatures,
  params,
  quality,
  reducedMotion,
  albumArtUrl,
  adaptive,
  adaptiveEnabled,
  onQualityChange,
  instanceRef,
  handlesRef,
}: {
  plugin: VisualizerPlugin;
  featuresRef: RefObject<AudioFeatureFrame>;
  resolveFeatures?: (nowMs: number) => AudioFeatureFrame;
  params: Record<string, unknown>;
  quality: QualityTier;
  reducedMotion: boolean;
  albumArtUrl?: string | null;
  adaptive: AdaptiveQualityManagerType;
  adaptiveEnabled: boolean;
  onQualityChange?: (tier: QualityTier) => void;
  instanceRef: RefObject<ReturnType<VisualizerPlugin["mount"]> | null>;
  handlesRef: RefObject<HostHandles | null>;
}) {
  const { scene, camera, gl, size } = useThree();
  const latest = useRef({
    params,
    quality,
    reducedMotion,
    albumArtUrl,
    pluginId: plugin.id,
    resolveFeatures,
  });
  latest.current = {
    params,
    quality,
    reducedMotion,
    albumArtUrl,
    pluginId: plugin.id,
    resolveFeatures,
  };
  const hostRef = useRef({
    scene,
    camera,
    gl,
    width: size.width,
    height: size.height,
    plugin,
    params,
    quality,
    reducedMotion,
    albumArtUrl,
    adaptiveEnabled,
    adaptive,
    featuresRef,
  });
  hostRef.current = {
    scene,
    camera,
    gl,
    width: size.width,
    height: size.height,
    plugin,
    params,
    quality,
    reducedMotion,
    albumArtUrl,
    adaptiveEnabled,
    adaptive,
    featuresRef,
  };
  const lastFrameMs = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  const mountedPluginId = useRef<string | null>(null);
  const updatePropsRef = useRef({
    features: createSilentFeatureFrame(),
    preset: { params },
    quality,
    reducedMotion,
    albumArtUrl: albumArtUrl ?? undefined,
  });

  // Capture host handles and keep camera / backing store in sync with the R3F container.
  useEffect(() => {
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    handlesRef.current = {
      scene,
      camera,
      renderer: gl,
      width,
      height,
    };
    const tier = adaptiveEnabled ? adaptive.getEffectiveTier() : quality;
    const caps = qualityCaps(tier);
    const dpr =
      typeof window !== "undefined" ? clampDpr(window.devicePixelRatio || 1, tier) : caps.dprCap;
    applyVisualizerResize({
      renderer: gl,
      camera,
      cameraMode: plugin.preferredCamera ?? "perspective",
      cssWidth: width,
      cssHeight: height,
      devicePixelRatio: dpr,
      dprCap: caps.dprCap,
    });
    instanceRef.current?.resize(width, height);
  }, [
    scene,
    camera,
    gl,
    size.width,
    size.height,
    handlesRef,
    instanceRef,
    plugin.preferredCamera,
    adaptive,
    adaptiveEnabled,
    quality,
  ]);

  // Mount / remount plugin in-place when plugin identity changes — never remount Canvas.
  useEffect(() => {
    const host = hostRef.current;
    const width = Math.max(1, host.width);
    const height = Math.max(1, host.height);
    handlesRef.current = {
      scene: host.scene,
      camera: host.camera,
      renderer: host.gl,
      width,
      height,
    };

    instanceRef.current?.dispose();
    instanceRef.current = null;
    clearScenePlugins(host.scene);

    const mode = host.plugin.preferredCamera ?? "perspective";
    applyCameraMode(host.camera, mode, width, height);

    const instance = host.plugin.mount({
      scene: host.scene,
      camera: host.camera,
      renderer: host.gl,
      width,
      height,
    });
    instanceRef.current = instance;
    mountedPluginId.current = host.plugin.id;

    const tier = host.adaptiveEnabled ? host.adaptive.getEffectiveTier() : host.quality;
    instance.setQuality(tier);
    instance.resize(width, height);
    instance.update({
      features: host.featuresRef.current ?? createSilentFeatureFrame(),
      preset: { params: host.params },
      quality: tier,
      reducedMotion: host.reducedMotion,
      albumArtUrl: host.albumArtUrl,
    });

    const sceneForCleanup = host.scene;
    return () => {
      instance.dispose();
      if (instanceRef.current === instance) {
        instanceRef.current = null;
      }
      clearScenePlugins(sceneForCleanup);
      mountedPluginId.current = null;
    };
  }, [plugin.id, instanceRef, handlesRef]);

  useEffect(() => {
    if (adaptiveEnabled) {
      adaptive.setManualTier(null);
      adaptive.setAutoTier(quality);
    } else {
      adaptive.setManualTier(quality);
    }
    const tier = adaptive.getEffectiveTier();
    instanceRef.current?.setQuality(tier);
    const caps = qualityCaps(tier);
    const dpr =
      typeof window !== "undefined" ? clampDpr(window.devicePixelRatio || 1, tier) : caps.dprCap;
    gl.setPixelRatio(Math.max(0.5, dpr * caps.resolutionScale));
  }, [quality, adaptiveEnabled, adaptive, gl, instanceRef]);

  useFrame(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    const now = typeof performance !== "undefined" ? performance.now() : 0;
    const frameMs = now - lastFrameMs.current;
    lastFrameMs.current = now;
    noteRenderFrame(now);

    if (adaptiveEnabled) {
      const changed = adaptive.sampleFrame(frameMs, now);
      if (changed) {
        const tier = adaptive.getEffectiveTier();
        instanceRef.current?.setQuality(tier);
        const caps = qualityCaps(tier);
        const dpr =
          typeof window !== "undefined"
            ? clampDpr(window.devicePixelRatio || 1, tier)
            : caps.dprCap;
        gl.setPixelRatio(dpr * caps.resolutionScale);
        onQualityChange?.(tier);
      }
    }

    const instance = instanceRef.current;
    const resolver = latest.current.resolveFeatures;
    const features = resolver ? resolver(now) : featuresRef.current;
    if (!instance || !features) return;
    if (mountedPluginId.current !== latest.current.pluginId) return;

    const tier = adaptiveEnabled ? adaptive.getEffectiveTier() : latest.current.quality;
    const props = updatePropsRef.current;
    props.features = features;
    props.preset.params = latest.current.params;
    props.quality = tier;
    props.reducedMotion = latest.current.reducedMotion;
    props.albumArtUrl = latest.current.albumArtUrl;
    instance.update(props);
  });

  return null;
}

/**
 * R3F host that mounts a visualizer plugin into the Three scene and disposes on unmount.
 * Plugin switches remount the instance in-place without recreating the Canvas or render loop.
 */
export function VisualizerCanvas({
  plugin,
  featuresRef,
  resolveFeatures,
  quality = "high",
  adaptiveQuality = true,
  className,
  style,
  params,
  albumArtUrl = null,
  fallback,
  onQualityChange,
}: VisualizerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [supported, setSupported] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [frameloop, setFrameloop] = useState<"always" | "never">("always");
  const instanceRef = useRef<ReturnType<VisualizerPlugin["mount"]> | null>(null);
  const handlesRef = useRef<HostHandles | null>(null);
  const adaptiveRef = useRef(new AdaptiveQualityManager({ initialTier: quality }));

  useEffect(() => {
    setSupported(isWebGLAvailable());
    const initialMotion = readPrefersReducedMotion();
    setReducedMotion(initialMotion);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      setReducedMotion(mq.matches);
    };
    mq.addEventListener("change", onMotion);
    const onVisibility = () => {
      setFrameloop(document.visibilityState === "hidden" ? "never" : "always");
    };
    document.addEventListener("visibilitychange", onVisibility);
    const releaseLoop = acquireAnimationLoop();
    return () => {
      mq.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
      releaseLoop();
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return observeElementSize(el, (width, height) => {
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      const handles = handlesRef.current;
      if (!handles) return;
      handles.width = w;
      handles.height = h;
      const tier = adaptiveRef.current.getEffectiveTier();
      const caps = qualityCaps(tier);
      const dpr =
        typeof window !== "undefined" ? clampDpr(window.devicePixelRatio || 1, tier) : caps.dprCap;
      applyVisualizerResize({
        renderer: handles.renderer,
        camera: handles.camera,
        cameraMode: plugin.preferredCamera ?? "perspective",
        cssWidth: w,
        cssHeight: h,
        devicePixelRatio: dpr,
        dprCap: caps.dprCap,
      });
      instanceRef.current?.resize(w, h);
    });
  }, [plugin.preferredCamera]);

  useEffect(() => {
    return () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  if (!supported) {
    return (
      <div className={className} style={style} role="status">
        {fallback ?? (
          <p>WebGL is unavailable, so Prism cannot render visualizers in this browser.</p>
        )}
      </div>
    );
  }

  const resolvedParams = params ?? plugin.defaultParams;

  return (
    <div
      ref={containerRef}
      className={["prism-visualizer-host", className].filter(Boolean).join(" ")}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        ...style,
      }}
      data-visualizer={plugin.id}
      data-testid="visualizer-host"
    >
      <Canvas
        camera={{ position: [0, 0, 8], fov: 50, near: 0.1, far: 200 }}
        dpr={1}
        frameloop={frameloop}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        resize={{ scroll: false, debounce: 0, offsetSize: true }}
        style={{ ...VISUALIZER_HOST_FILL_STYLE }}
      >
        <color attach="background" args={["#061018"]} />
        <PluginRuntime
          plugin={plugin}
          featuresRef={featuresRef}
          resolveFeatures={resolveFeatures}
          params={resolvedParams}
          quality={quality}
          reducedMotion={reducedMotion}
          albumArtUrl={albumArtUrl}
          adaptive={adaptiveRef.current}
          adaptiveEnabled={adaptiveQuality}
          onQualityChange={onQualityChange}
          instanceRef={instanceRef}
          handlesRef={handlesRef}
        />
      </Canvas>
    </div>
  );
}

export function createFallbackFeatures(): AudioFeatureFrame {
  return createSilentFeatureFrame(typeof performance !== "undefined" ? performance.now() : 0);
}

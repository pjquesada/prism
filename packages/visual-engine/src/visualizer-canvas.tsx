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
  });
  latest.current = {
    params,
    quality,
    reducedMotion,
    albumArtUrl,
    pluginId: plugin.id,
  };
  const lastFrameMs = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  const mountedPluginId = useRef<string | null>(null);

  // Capture host handles once for external resize / remount helpers.
  useEffect(() => {
    handlesRef.current = {
      scene,
      camera,
      renderer: gl,
      width: size.width,
      height: size.height,
    };
  }, [scene, camera, gl, size.width, size.height, handlesRef]);

  // Mount / remount plugin in-place when plugin identity changes — never remount Canvas.
  useEffect(() => {
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    handlesRef.current = { scene, camera, renderer: gl, width, height };

    instanceRef.current?.dispose();
    instanceRef.current = null;
    clearScenePlugins(scene);

    const mode = plugin.preferredCamera ?? "perspective";
    applyCameraMode(camera, mode, width, height);

    const instance = plugin.mount({
      scene,
      camera,
      renderer: gl,
      width,
      height,
    });
    instanceRef.current = instance;
    mountedPluginId.current = plugin.id;

    const tier = adaptiveEnabled ? adaptive.getEffectiveTier() : quality;
    instance.setQuality(tier);
    instance.resize(width, height);
    instance.update({
      features: featuresRef.current ?? createSilentFeatureFrame(),
      preset: { params },
      quality: tier,
      reducedMotion,
      albumArtUrl,
    });

    return () => {
      instance.dispose();
      if (instanceRef.current === instance) {
        instanceRef.current = null;
      }
      clearScenePlugins(scene);
      mountedPluginId.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount only on plugin id
  }, [plugin.id]);

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
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    const frameMs = now - lastFrameMs.current;
    lastFrameMs.current = now;

    if (adaptiveEnabled) {
      const changed = adaptive.sampleFrame(frameMs, now);
      if (changed) {
        const tier = adaptive.getEffectiveTier();
        instanceRef.current?.setQuality(tier);
        const caps = qualityCaps(tier);
        const dpr =
          typeof window !== "undefined" ? clampDpr(window.devicePixelRatio || 1, tier) : caps.dprCap;
        gl.setPixelRatio(dpr * caps.resolutionScale);
        onQualityChange?.(tier);
      }
    }

    const instance = instanceRef.current;
    const features = featuresRef.current;
    if (!instance || !features) return;
    if (mountedPluginId.current !== latest.current.pluginId) return;

    const tier = adaptiveEnabled ? adaptive.getEffectiveTier() : latest.current.quality;
    instance.update({
      features,
      preset: { params: latest.current.params },
      quality: tier,
      reducedMotion: latest.current.reducedMotion,
      albumArtUrl: latest.current.albumArtUrl,
    });
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
    return () => mq.removeEventListener("change", onMotion);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      if (handlesRef.current) {
        handlesRef.current.width = w;
        handlesRef.current.height = h;
        applyCameraMode(
          handlesRef.current.camera,
          plugin.preferredCamera ?? "perspective",
          w,
          h,
        );
      }
      instanceRef.current?.resize(w, h);
    });
    ro.observe(el);
    return () => ro.disconnect();
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
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: "16rem", ...style }}
      data-visualizer={plugin.id}
    >
      <Canvas
        camera={{ position: [0, 0, 8], fov: 50, near: 0.1, far: 200 }}
        dpr={1}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <color attach="background" args={["#061018"]} />
        <PluginRuntime
          plugin={plugin}
          featuresRef={featuresRef}
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

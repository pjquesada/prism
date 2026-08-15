"use client";

import { Canvas, useFrame } from "@react-three/fiber";
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

import { isWebGLAvailable, readPrefersReducedMotion, type VisualizerPlugin } from "./types.js";

export type VisualizerCanvasProps = {
  plugin: VisualizerPlugin;
  /** Prefer a ref for high-frequency frames to avoid React render thrash. */
  featuresRef: RefObject<AudioFeatureFrame>;
  quality?: QualityTier;
  className?: string;
  style?: CSSProperties;
  params?: Record<string, unknown>;
  fallback?: ReactNode;
};

function PluginUpdater({
  getInstance,
  featuresRef,
  params,
  quality,
  reducedMotion,
}: {
  getInstance: () => ReturnType<VisualizerPlugin["mount"]> | null;
  featuresRef: RefObject<AudioFeatureFrame>;
  params: Record<string, unknown>;
  quality: QualityTier;
  reducedMotion: boolean;
}) {
  const latest = useRef({ params, quality, reducedMotion });
  latest.current = { params, quality, reducedMotion };

  useFrame(() => {
    const instance = getInstance();
    const features = featuresRef.current;
    if (!instance || !features) return;
    instance.update({
      features,
      preset: { params: latest.current.params },
      quality: latest.current.quality,
      reducedMotion: latest.current.reducedMotion,
    });
  });

  return null;
}

/**
 * R3F host that mounts a visualizer plugin into the Three scene and disposes on unmount.
 */
export function VisualizerCanvas({
  plugin,
  featuresRef,
  quality = "high",
  className,
  style,
  params,
  fallback,
}: VisualizerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [supported, setSupported] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const instanceRef = useRef<ReturnType<VisualizerPlugin["mount"]> | null>(null);
  const paramsRef = useRef(params ?? plugin.defaultParams);
  const qualityRef = useRef(quality);
  const reducedRef = useRef(false);

  paramsRef.current = params ?? plugin.defaultParams;
  qualityRef.current = quality;

  useEffect(() => {
    setSupported(isWebGLAvailable());
    const initialMotion = readPrefersReducedMotion();
    setReducedMotion(initialMotion);
    reducedRef.current = initialMotion;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      const next = mq.matches;
      setReducedMotion(next);
      reducedRef.current = next;
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
      instanceRef.current?.resize(Math.max(1, width), Math.max(1, height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    instanceRef.current?.setQuality(quality);
  }, [quality]);

  useEffect(() => {
    return () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, [plugin]);

  if (!supported) {
    return (
      <div className={className} style={style} role="status">
        {fallback ?? (
          <p>
            WebGL is unavailable, so Prism cannot render the Spectrum visualizer in this browser.
          </p>
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
        orthographic
        camera={{ position: [0, 0, 10], zoom: 50, near: 0.1, far: 100 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ width: "100%", height: "100%", display: "block" }}
        onCreated={({ scene, camera, gl, size }) => {
          instanceRef.current?.dispose();
          const instance = plugin.mount({
            scene,
            camera,
            renderer: gl,
            width: size.width,
            height: size.height,
          });
          instanceRef.current = instance;
          instance.setQuality(qualityRef.current);
          instance.resize(size.width, size.height);
          instance.update({
            features: featuresRef.current ?? createSilentFeatureFrame(),
            preset: { params: paramsRef.current },
            quality: qualityRef.current,
            reducedMotion: reducedRef.current,
          });
        }}
      >
        <color attach="background" args={["#061018"]} />
        <PluginUpdater
          getInstance={() => instanceRef.current}
          featuresRef={featuresRef}
          params={resolvedParams}
          quality={quality}
          reducedMotion={reducedMotion}
        />
      </Canvas>
    </div>
  );
}

export function createFallbackFeatures(): AudioFeatureFrame {
  return createSilentFeatureFrame(typeof performance !== "undefined" ? performance.now() : 0);
}

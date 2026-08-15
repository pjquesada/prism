import { describe, expect, it, vi } from "vitest";
import { BufferGeometry, OrthographicCamera, PointsMaterial, Scene } from "three";
import type { WebGLRenderer } from "three";

import { createSilentFeatureFrame, particlesParamsDefaults } from "@prism/contracts";

import { getParticlesActiveCount, particlesPlugin } from "./particles.js";

describe("particlesPlugin", () => {
  it("exposes particles metadata", () => {
    expect(particlesPlugin.id).toBe("particles");
    expect(particlesPlugin.defaultParams.particleCount).toBe(particlesParamsDefaults.particleCount);
  });

  it("updates from a pooled buffer without growing attribute arrays", () => {
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const renderer = {
      domElement: {} as HTMLCanvasElement,
      dispose: vi.fn(),
      setSize: vi.fn(),
    } as unknown as WebGLRenderer;

    const instance = particlesPlugin.mount({
      scene,
      camera,
      renderer,
      width: 640,
      height: 360,
    });

    const geoSpy = vi.spyOn(BufferGeometry.prototype, "dispose");
    const matSpy = vi.spyOn(PointsMaterial.prototype, "dispose");

    const features = {
      ...createSilentFeatureFrame(1, 32),
      bass: 0.7,
      mid: 0.5,
      high: 0.4,
      energy: 0.6,
      onset: true,
      beatPhase: 0.2,
    };

    for (let i = 0; i < 30; i += 1) {
      instance.update({
        features: { ...features, timestampMs: i * 16, onset: i % 10 === 0 },
        preset: { params: { ...particlesParamsDefaults, particleCount: 256 } },
        quality: "medium",
        reducedMotion: false,
      });
    }

    expect(getParticlesActiveCount(instance)).toBeGreaterThan(0);
    expect(getParticlesActiveCount(instance)).toBeLessThanOrEqual(640);

    instance.setQuality("low");
    instance.update({
      features,
      preset: { params: { ...particlesParamsDefaults, particleCount: 2048 } },
      quality: "low",
      reducedMotion: true,
    });
    expect(getParticlesActiveCount(instance)).toBeLessThanOrEqual(256);

    instance.dispose();
    expect(scene.children).toHaveLength(0);
    expect(geoSpy).toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalled();
    geoSpy.mockRestore();
    matSpy.mockRestore();
  });
});

import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, MeshBasicMaterial, OrthographicCamera, Scene } from "three";
import type { WebGLRenderer } from "three";

import { createSilentFeatureFrame, spectrumParamsDefaults } from "@prism/contracts";

import { spectrumPlugin } from "./spectrum.js";

describe("spectrumPlugin", () => {
  it("exposes spectrum metadata and default params", () => {
    expect(spectrumPlugin.id).toBe("spectrum");
    expect(spectrumPlugin.defaultParams.barCount).toBe(spectrumParamsDefaults.barCount);
  });

  it("mounts, updates, resizes, and disposes shared geometry/materials", () => {
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const canvas = {
      width: 64,
      height: 64,
      style: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getContext: vi.fn(),
    } as unknown as HTMLCanvasElement;

    // Avoid requiring a real WebGL context in unit tests.
    const renderer = {
      domElement: canvas,
      dispose: vi.fn(),
      setSize: vi.fn(),
    } as unknown as WebGLRenderer;

    const instance = spectrumPlugin.mount({
      scene,
      camera,
      renderer,
      width: 640,
      height: 360,
    });

    expect(scene.children.length).toBeGreaterThan(0);

    const geoSpy = vi.spyOn(BoxGeometry.prototype, "dispose");
    const matSpy = vi.spyOn(MeshBasicMaterial.prototype, "dispose");

    instance.update({
      features: {
        ...createSilentFeatureFrame(1, 32),
        bands: Array.from({ length: 32 }, (_, i) => (i % 4) / 4),
        energy: 0.4,
        onset: true,
        beatPhase: 0.2,
      },
      preset: { params: spectrumPlugin.defaultParams },
      quality: "medium",
      reducedMotion: false,
    });
    instance.setQuality("low");
    instance.resize(800, 450);
    instance.dispose();

    expect(scene.children).toHaveLength(0);
    expect(geoSpy).toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalled();
    geoSpy.mockRestore();
    matSpy.mockRestore();
  });
});

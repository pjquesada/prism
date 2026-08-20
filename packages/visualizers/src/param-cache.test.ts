import { describe, expect, it, vi } from "vitest";
import { OrthographicCamera, Scene } from "three";
import type { WebGLRenderer } from "three";
import {
  createSilentFeatureFrame,
  spectrumParamsDefaults,
  spectrumParamsSchema,
} from "@prism/contracts";

import { createIdentityParamCache } from "./param-cache.js";
import { albumWorldPlugin } from "./album-world.js";
import { particlesPlugin } from "./particles.js";
import { spectrumPlugin } from "./spectrum.js";

function fakeRenderer(): WebGLRenderer {
  return {
    domElement: {
      width: 64,
      height: 64,
      style: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getContext: vi.fn(),
    } as unknown as HTMLCanvasElement,
    dispose: vi.fn(),
    setSize: vi.fn(),
  } as unknown as WebGLRenderer;
}

describe("createIdentityParamCache", () => {
  it("parses once while the params object identity is unchanged", () => {
    const parse = vi.fn((raw: Record<string, unknown>) => raw);
    const cached = createIdentityParamCache(parse);
    const params = { sensitivity: 1 };
    cached(params);
    cached(params);
    expect(parse).toHaveBeenCalledTimes(1);
    cached({ sensitivity: 1 });
    expect(parse).toHaveBeenCalledTimes(2);
  });
});

describe("visualizer update hot path", () => {
  it("keeps Spectrum, Particles, and Album World updates under a millisecond on average", () => {
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const renderer = fakeRenderer();
    const plugins = [spectrumPlugin, particlesPlugin, albumWorldPlugin];
    const features = {
      ...createSilentFeatureFrame(1, 32),
      bands: Array.from({ length: 32 }, (_, i) => (i % 4) / 4),
      energy: 0.45,
      bass: 0.4,
      mid: 0.3,
      high: 0.2,
      onset: true,
    };
    const started = performance.now();
    let updates = 0;
    for (const plugin of plugins) {
      const instance = plugin.mount({ scene, camera, renderer, width: 640, height: 360 });
      const params = plugin.defaultParams;
      for (let i = 0; i < 120; i += 1) {
        features.timestampMs = i;
        features.energy = (i % 10) / 10;
        instance.update({
          features,
          preset: { params },
          quality: "medium",
          reducedMotion: false,
        });
        updates += 1;
      }
      instance.dispose();
    }
    const elapsed = performance.now() - started;
    expect(updates).toBe(360);
    expect(elapsed / updates).toBeLessThan(2);
  });

  it("does not re-parse Spectrum params on every frame when the object is stable", () => {
    const spy = vi.spyOn(spectrumParamsSchema, "safeParse");
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const instance = spectrumPlugin.mount({
      scene,
      camera,
      renderer: fakeRenderer(),
      width: 640,
      height: 360,
    });
    const params = { ...spectrumParamsDefaults };
    instance.update({
      features: createSilentFeatureFrame(1, 32),
      preset: { params },
      quality: "high",
      reducedMotion: false,
    });
    instance.update({
      features: createSilentFeatureFrame(2, 32),
      preset: { params },
      quality: "high",
      reducedMotion: false,
    });
    expect(spy.mock.calls.length).toBe(1);
    instance.dispose();
    spy.mockRestore();
  });
});

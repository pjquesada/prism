import { describe, expect, it } from "vitest";
import { OrthographicCamera, Scene } from "three";
import type { WebGLRenderer } from "three";

import { createSilentFeatureFrame } from "@prism/contracts";
import { computeBackingStoreSize } from "@prism/visual-engine";

import { albumWorldPlugin } from "./album-world.js";
import { particlesPlugin } from "./particles.js";
import { spectrumPlugin } from "./spectrum.js";

function mountAll(width: number, height: number) {
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  const renderer = {
    domElement: { width, height, style: {} } as HTMLCanvasElement,
    dispose: viDispose(),
    setSize: viDispose(),
  } as unknown as WebGLRenderer;
  return {
    spectrum: spectrumPlugin.mount({ scene, camera, renderer, width, height }),
    particles: particlesPlugin.mount({ scene, camera, renderer, width, height }),
    albumWorld: albumWorldPlugin.mount({ scene, camera, renderer, width, height }),
    scene,
  };
}

function viDispose() {
  return () => undefined;
}

describe("visualizers share a display stage", () => {
  it("Spectrum, Particles, and Album World resize to the same stage size", () => {
    const stage = { width: 1920, height: 1080 };
    const backing = computeBackingStoreSize(stage.width, stage.height, 2, 2);
    const mounted = mountAll(stage.width, stage.height);
    const features = {
      ...createSilentFeatureFrame(1, 32),
      energy: 0.4,
      bass: 0.3,
      mid: 0.2,
      high: 0.1,
    };
    for (const instance of [mounted.spectrum, mounted.particles, mounted.albumWorld]) {
      instance.update({
        features,
        preset: { params: {} },
        quality: "high",
        reducedMotion: false,
      });
      instance.resize(stage.width, stage.height);
    }
    expect(backing.cssWidth).toBe(1920);
    expect(backing.cssHeight).toBe(1080);
    expect(backing.backingWidth).toBe(3840);
    mounted.spectrum.dispose();
    mounted.particles.dispose();
    mounted.albumWorld.dispose();
  });
});

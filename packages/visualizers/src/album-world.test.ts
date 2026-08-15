import { describe, expect, it, vi } from "vitest";
import { MeshStandardMaterial, OrthographicCamera, PlaneGeometry, Scene } from "three";
import type { WebGLRenderer } from "three";

import { albumWorldParamsDefaults, createSilentFeatureFrame } from "@prism/contracts";

import { albumWorldPlugin } from "./album-world.js";
import { getVisualizerPlugin, listVisualizerPlugins, requireVisualizerPlugin } from "./registry.js";

describe("albumWorldPlugin", () => {
  it("mounts layered scene and disposes resources", async () => {
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const renderer = {
      domElement: {} as HTMLCanvasElement,
      dispose: vi.fn(),
      setSize: vi.fn(),
    } as unknown as WebGLRenderer;

    const instance = albumWorldPlugin.mount({
      scene,
      camera,
      renderer,
      width: 800,
      height: 450,
    });

    const geoSpy = vi.spyOn(PlaneGeometry.prototype, "dispose");
    const matSpy = vi.spyOn(MeshStandardMaterial.prototype, "dispose");

    instance.update({
      features: {
        ...createSilentFeatureFrame(2, 32),
        bass: 0.4,
        mid: 0.3,
        high: 0.2,
        energy: 0.35,
        onset: true,
      },
      preset: { params: albumWorldParamsDefaults },
      quality: "high",
      reducedMotion: false,
      albumArtUrl: null,
    });

    instance.setQuality("low");
    instance.resize(1024, 576);
    instance.dispose();

    expect(scene.children).toHaveLength(0);
    expect(geoSpy).toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalled();
    geoSpy.mockRestore();
    matSpy.mockRestore();
  });
});

describe("visualizer registry", () => {
  it("lists phase 1C plugins and falls back safely", () => {
    expect(listVisualizerPlugins().map((p) => p.id)).toEqual([
      "spectrum",
      "particles",
      "album_world",
    ]);
    expect(getVisualizerPlugin("dreamscape")).toBeNull();
    expect(requireVisualizerPlugin("dreamscape").id).toBe("spectrum");
    expect(getVisualizerPlugin("particles")?.id).toBe("particles");
  });
});

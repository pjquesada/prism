import {
  albumWorldParamsDefaults,
  albumWorldParamsSchema,
  type AlbumWorldParams,
  type QualityTier,
} from "@prism/contracts";
import type {
  VisualizerInstance,
  VisualizerMountContext,
  VisualizerPlugin,
  VisualizerProps,
} from "@prism/visual-engine";
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Scene,
  type Texture,
} from "three";

import { extractPaletteFromImageData, type Rgb } from "./palette.js";
import { createIdentityParamCache } from "./param-cache.js";

const PLACEHOLDER_DATA_URL =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0a1c28"/>
          <stop offset="55%" stop-color="#2ec4b6"/>
          <stop offset="100%" stop-color="#e07a3d"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" fill="url(#g)"/>
      <circle cx="256" cy="240" r="120" fill="none" stroke="#e6f2f5" stroke-opacity="0.35" stroke-width="8"/>
      <circle cx="256" cy="240" r="56" fill="#e6f2f5" fill-opacity="0.18"/>
    </svg>`,
  );

type LayerMesh = Mesh<PlaneGeometry, MeshStandardMaterial>;

function parseParams(raw: Record<string, unknown>): AlbumWorldParams {
  const parsed = albumWorldParamsSchema.safeParse(raw);
  return parsed.success ? parsed.data : albumWorldParamsDefaults;
}

function layerCountForQuality(tier: QualityTier, requested: number): number {
  const cap = tier === "low" ? 2 : tier === "medium" ? 3 : tier === "high" ? 4 : 6;
  return Math.min(requested, cap);
}

class AlbumWorldInstance implements VisualizerInstance {
  private readonly scene: Scene;
  private readonly root = new Group();
  private readonly ambient: AmbientLight;
  private readonly keyLight: DirectionalLight;
  private readonly loader = new TextureLoader();
  private layers: LayerMesh[] = [];
  private sharedGeometry: PlaneGeometry;
  private texture: Texture | null = null;
  private loadingUrl: string | null = null;
  private quality: QualityTier = "high";
  private disposed = false;
  private artworkError = false;
  private palette: Rgb[] = [
    { r: 46, g: 196, b: 182 },
    { r: 224, g: 122, b: 61 },
  ];
  private avg = new Color("#0a1c28");
  private beatPulse = 0;
  private lastFlashMs = -Infinity;
  private readonly paramsOf = createIdentityParamCache(parseParams);

  constructor(ctx: VisualizerMountContext) {
    this.scene = ctx.scene;
    this.sharedGeometry = new PlaneGeometry(4.5, 4.5, 1, 1);
    this.ambient = new AmbientLight(0x6a8a96, 0.55);
    this.keyLight = new DirectionalLight(0xffffff, 1.1);
    this.keyLight.position.set(2.5, 3.5, 4);
    this.root.add(this.ambient);
    this.root.add(this.keyLight);
    this.scene.add(this.root);
    this.rebuildLayers(4);
    void this.loadArtwork(null);
  }

  update(props: VisualizerProps): void {
    if (this.disposed) return;
    const params = this.paramsOf(props.preset.params);
    const desired = layerCountForQuality(this.quality, params.depthLayers);
    if (desired !== this.layers.length) {
      this.rebuildLayers(desired);
    }

    const artUrl = props.albumArtUrl?.trim() ? props.albumArtUrl : null;
    if (artUrl !== this.loadingUrl && !this.isSameEffectiveUrl(artUrl)) {
      void this.loadArtwork(artUrl);
    }

    const motion = props.reducedMotion ? 0.25 : 1;
    const energy = props.features.energy * params.sensitivity;
    const bass = props.features.bass * params.sensitivity;
    const mid = props.features.mid;
    const now = props.features.timestampMs;

    const flashAllowed = now - this.lastFlashMs > 200;
    if (props.features.onset && flashAllowed && !props.reducedMotion) {
      this.beatPulse = Math.min(1, 0.55 * params.lightReactivity);
      this.lastFlashMs = now;
    } else {
      this.beatPulse *= props.reducedMotion ? 0.75 : 0.9;
    }

    const parallax = params.parallaxStrength * motion;
    const phase = props.features.beatPhase;

    for (let i = 0; i < this.layers.length; i += 1) {
      const layer = this.layers[i];
      if (!layer) continue;
      const depth = (i + 1) / this.layers.length;
      const z = -i * 0.55 - 0.2;
      layer.position.z = z;
      layer.position.x = Math.sin(phase * Math.PI * 2 + depth) * 0.15 * parallax * (1.2 - depth);
      layer.position.y =
        Math.cos(phase * Math.PI * 2 * 0.5 + depth * 1.3) * 0.1 * parallax + bass * 0.08 * motion;
      const scale = 1 + (1 - depth) * 0.12 + energy * 0.04 * params.displacement * motion;
      layer.scale.setScalar(scale);
      layer.rotation.z = (mid - 0.5) * 0.04 * params.displacement * motion;

      const mat = layer.material;
      mat.emissiveIntensity = 0.08 + energy * 0.25 * params.lightReactivity + this.beatPulse * 0.2;
      mat.opacity = 0.35 + (1 - depth) * 0.45;
    }

    const accent = this.palette[0] ?? { r: 46, g: 196, b: 182 };
    this.keyLight.color.setRGB(accent.r / 255, accent.g / 255, accent.b / 255);
    this.keyLight.intensity = 0.7 + energy * 0.9 * params.lightReactivity + this.beatPulse * 0.5;
    this.ambient.intensity = 0.35 + params.fogDensity * 0.25;
    this.root.rotation.y = props.reducedMotion
      ? 0
      : Math.sin(phase * Math.PI * 2) * 0.05 * parallax;
  }

  setQuality(tier: QualityTier): void {
    this.quality = tier;
  }

  resize(width: number, height: number): void {
    void width;
    void height;
    // Perspective camera + fixed world planes.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeLayers();
    this.disposeTexture();
    this.sharedGeometry.dispose();
    this.scene.remove(this.root);
  }

  getArtworkError(): boolean {
    return this.artworkError;
  }

  private isSameEffectiveUrl(url: string | null): boolean {
    const effective = url ?? PLACEHOLDER_DATA_URL;
    return this.loadingUrl === effective;
  }

  private async loadArtwork(url: string | null): Promise<void> {
    const target = url ?? PLACEHOLDER_DATA_URL;
    this.loadingUrl = target;
    this.artworkError = false;

    try {
      const texture = await this.loader.loadAsync(target);
      if (this.disposed || this.loadingUrl !== target) {
        texture.dispose();
        return;
      }
      this.disposeTexture();
      this.texture = texture;
      texture.colorSpace = SRGBColorSpace;
      this.applyTextureToLayers(texture);
      await this.samplePalette(texture, target);
    } catch {
      if (this.disposed) return;
      this.artworkError = Boolean(url);
      if (url) {
        // Fall back to placeholder on invalid user artwork.
        void this.loadArtwork(null);
      }
    }
  }

  private async samplePalette(texture: Texture, sourceUrl: string): Promise<void> {
    if (typeof document === "undefined") return;
    try {
      const img = texture.image as
        | HTMLImageElement
        | HTMLCanvasElement
        | ImageBitmap
        | { width: number; height: number }
        | undefined;
      if (!img || typeof (img as { width?: number }).width !== "number") {
        // Data URL / SVG path: paint via Image element.
        await this.sampleFromUrl(sourceUrl);
        return;
      }
      const width = Math.min(64, (img as { width: number }).width || 64);
      const height = Math.min(64, (img as { height: number }).height || 64);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img as CanvasImageSource, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const palette = extractPaletteFromImageData(imageData.data, 4);
      this.palette = palette.colors;
      this.avg.setRGB(palette.average.r / 255, palette.average.g / 255, palette.average.b / 255);
      this.tintLayersFromPalette();
    } catch {
      // Keep previous palette.
    }
  }

  private async sampleFromUrl(url: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 64;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(image, 0, 0, 64, 64);
            const imageData = ctx.getImageData(0, 0, 64, 64);
            const palette = extractPaletteFromImageData(imageData.data, 4);
            this.palette = palette.colors;
            this.avg.setRGB(
              palette.average.r / 255,
              palette.average.g / 255,
              palette.average.b / 255,
            );
            this.tintLayersFromPalette();
          }
        } finally {
          resolve();
        }
      };
      image.onerror = () => resolve();
      image.src = url;
    });
  }

  private applyTextureToLayers(texture: Texture): void {
    for (const layer of this.layers) {
      layer.material.map = texture;
      layer.material.needsUpdate = true;
    }
    this.tintLayersFromPalette();
  }

  private tintLayersFromPalette(): void {
    for (let i = 0; i < this.layers.length; i += 1) {
      const layer = this.layers[i];
      if (!layer) continue;
      const color = this.palette[i % this.palette.length] ?? this.palette[0];
      if (!color) continue;
      layer.material.color.setRGB(color.r / 255, color.g / 255, color.b / 255);
      layer.material.emissive.copy(this.avg);
    }
  }

  private rebuildLayers(count: number): void {
    this.disposeLayers();
    for (let i = 0; i < count; i += 1) {
      const material = new MeshStandardMaterial({
        color: new Color("#2ec4b6"),
        transparent: true,
        opacity: 0.7,
        metalness: 0.05,
        roughness: 0.65,
        depthWrite: false,
        map: this.texture,
      });
      const mesh = new Mesh(this.sharedGeometry, material);
      mesh.position.z = -i * 0.55;
      this.root.add(mesh);
      this.layers.push(mesh);
    }
    this.tintLayersFromPalette();
  }

  private disposeLayers(): void {
    for (const layer of this.layers) {
      this.root.remove(layer);
      layer.material.map = null;
      layer.material.dispose();
    }
    this.layers = [];
  }

  private disposeTexture(): void {
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
  }
}

export const albumWorldPlugin: VisualizerPlugin = {
  id: "album_world",
  label: "Album World",
  description: "Layered parallax world tinted by local artwork palette.",
  defaultParams: { ...albumWorldParamsDefaults },
  paramsSchema: albumWorldParamsSchema,
  supportsAlbumArt: true,
  supportsDreamscapeKeyframes: false,
  preferredCamera: "perspective",
  mount(ctx) {
    return new AlbumWorldInstance(ctx);
  },
};

export const ALBUM_WORLD_PLACEHOLDER_URL = PLACEHOLDER_DATA_URL;

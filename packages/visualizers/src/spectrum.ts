import {
  spectrumParamsDefaults,
  spectrumParamsSchema,
  type QualityTier,
  type SpectrumParams,
} from "@prism/contracts";
import type {
  VisualizerInstance,
  VisualizerMountContext,
  VisualizerPlugin,
  VisualizerProps,
} from "@prism/visual-engine";
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, type Scene } from "three";

type BarMesh = Mesh<BoxGeometry, MeshBasicMaterial>;

function qualityBarCap(tier: QualityTier): number {
  switch (tier) {
    case "low":
      return 16;
    case "medium":
      return 24;
    case "ultra":
      return 48;
    case "high":
    default:
      return 32;
  }
}

function parseParams(raw: Record<string, unknown>): SpectrumParams {
  const parsed = spectrumParamsSchema.safeParse(raw);
  return parsed.success ? parsed.data : spectrumParamsDefaults;
}

class SpectrumInstance implements VisualizerInstance {
  private readonly scene: Scene;
  private readonly root = new Group();
  private bars: BarMesh[] = [];
  private geometry: BoxGeometry;
  private quality: QualityTier = "high";
  private width: number;
  private height: number;
  private disposed = false;
  private beatPulse = 0;

  constructor(ctx: VisualizerMountContext) {
    this.scene = ctx.scene;
    this.width = ctx.width;
    this.height = ctx.height;
    this.geometry = new BoxGeometry(1, 1, 1);
    this.geometry.translate(0, 0.5, 0);
    this.scene.add(this.root);
    this.rebuildBars(spectrumParamsDefaults.barCount);
  }

  update(props: VisualizerProps): void {
    if (this.disposed) return;
    const params = parseParams(props.preset.params);
    const cap = qualityBarCap(this.quality);
    const desired = Math.min(params.barCount, cap);
    if (desired !== this.bars.length) {
      this.rebuildBars(desired);
    }

    const bands = props.features.bands;
    const motionScale = props.reducedMotion ? 0.35 : 1;
    const beatBoost =
      props.reducedMotion || !props.features.onset ? 0 : params.beatEmphasis * motionScale;

    this.beatPulse = Math.max(this.beatPulse * (props.reducedMotion ? 0.7 : 0.85), beatBoost);

    const span = 10;
    const gap = params.barGap;
    const totalGap = gap * (this.bars.length - 1);
    const barWidth = (span - totalGap) / Math.max(this.bars.length, 1);
    const startX = -span / 2 + barWidth / 2;

    for (let i = 0; i < this.bars.length; i += 1) {
      const bar = this.bars[i];
      if (!bar) continue;
      const sampleIndex = Math.floor((i / this.bars.length) * Math.max(bands.length, 1));
      const raw = bands[sampleIndex] ?? 0;
      const level = Math.min(1, raw * params.sensitivity * motionScale + this.beatPulse * 0.25);
      const height = 0.15 + level * 4.5;
      bar.scale.set(Math.max(barWidth * (1 - gap * 0.35), 0.08), height, 0.35);
      bar.position.x = startX + i * (barWidth + gap);
      bar.position.y = -2.2;

      const t = this.bars.length <= 1 ? 0 : i / (this.bars.length - 1);
      const hue = params.baseHue + (params.accentHue - params.baseHue) * t;
      const lightness = 0.42 + level * 0.28 + this.beatPulse * 0.08;
      bar.material.color.setHSL((((hue % 360) + 360) % 360) / 360, 0.55, Math.min(0.72, lightness));
    }

    this.root.rotation.z = props.reducedMotion ? 0 : props.features.beatPhase * 0.02;
  }

  setQuality(tier: QualityTier): void {
    this.quality = tier;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const bar of this.bars) {
      this.root.remove(bar);
      bar.material.dispose();
    }
    this.bars = [];
    this.geometry.dispose();
    this.scene.remove(this.root);
  }

  private rebuildBars(count: number): void {
    for (const bar of this.bars) {
      this.root.remove(bar);
      bar.material.dispose();
    }
    this.bars = [];
    for (let i = 0; i < count; i += 1) {
      const material = new MeshBasicMaterial({
        color: new Color("#2ec4b6"),
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new Mesh(this.geometry, material);
      this.root.add(mesh);
      this.bars.push(mesh);
    }
  }
}

export const spectrumPlugin: VisualizerPlugin = {
  id: "spectrum",
  label: "Spectrum",
  description: "Frequency bars driven by local Demo Track analysis.",
  defaultParams: { ...spectrumParamsDefaults },
  paramsSchema: spectrumParamsSchema,
  supportsAlbumArt: false,
  supportsDreamscapeKeyframes: false,
  preferredCamera: "perspective",
  mount(ctx) {
    return new SpectrumInstance(ctx);
  },
};

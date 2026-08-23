import {
  particlesParamsDefaults,
  particlesParamsSchema,
  type ParticlesParams,
  type QualityTier,
} from "@prism/contracts";
import { QUALITY_CAPS } from "@prism/visual-engine";
import type {
  VisualizerInstance,
  VisualizerMountContext,
  VisualizerPlugin,
  VisualizerProps,
} from "@prism/visual-engine";
import { BufferAttribute, BufferGeometry, Color, Points, PointsMaterial, type Scene } from "three";

import { createIdentityParamCache } from "./param-cache.js";

const MAX_POOL = 4096;
/** Minimum ms between full-screen-ish burst flashes (photosensitivity). */
const MIN_BURST_INTERVAL_MS = 180;

type ParticlePool = {
  positions: Float32Array;
  velocities: Float32Array;
  ages: Float32Array;
  lifetimes: Float32Array;
  sizes: Float32Array;
  kinds: Uint8Array; // 0 bass, 1 mid, 2 sparkle
  active: Uint8Array;
};

function createPool(capacity: number): ParticlePool {
  return {
    positions: new Float32Array(capacity * 3),
    velocities: new Float32Array(capacity * 3),
    ages: new Float32Array(capacity),
    lifetimes: new Float32Array(capacity),
    sizes: new Float32Array(capacity),
    kinds: new Uint8Array(capacity),
    active: new Uint8Array(capacity),
  };
}

function parseParams(raw: Record<string, unknown>): ParticlesParams {
  const parsed = particlesParamsSchema.safeParse(raw);
  return parsed.success ? parsed.data : particlesParamsDefaults;
}

function particleCap(tier: QualityTier, requested: number): number {
  return Math.min(requested, QUALITY_CAPS[tier].particleCount, MAX_POOL);
}

class ParticlesInstance implements VisualizerInstance {
  private readonly scene: Scene;
  private readonly geometry: BufferGeometry;
  private readonly material: PointsMaterial;
  private readonly points: Points;
  private readonly pool: ParticlePool;
  private readonly color = new Color();
  private quality: QualityTier = "high";
  private capacity = MAX_POOL;
  private activeCount = 0;
  private disposed = false;
  private lastBurstMs = -Infinity;
  private burstPulse = 0;
  private time = 0;
  private cursor = 0;
  private readonly paramsOf = createIdentityParamCache(parseParams);

  constructor(ctx: VisualizerMountContext) {
    this.scene = ctx.scene;
    this.pool = createPool(MAX_POOL);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new BufferAttribute(this.pool.positions, 3));
    this.geometry.setAttribute("size", new BufferAttribute(this.pool.sizes, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new PointsMaterial({
      color: "#2ec4b6",
      size: 0.12,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new Points(this.geometry, this.material);
    this.scene.add(this.points);

    // Seed a quiet field so the first frames are never empty.
    for (let i = 0; i < 128; i += 1) {
      this.spawn(1, 0.2, 0.15, 0.1, false);
    }
    this.syncDrawRange();
  }

  update(props: VisualizerProps): void {
    if (this.disposed) return;
    const params = this.paramsOf(props.preset.params);
    this.capacity = particleCap(this.quality, params.particleCount);

    const motion = props.reducedMotion ? 0.28 : 1;
    const photoSafe = props.reducedMotion ? 0.2 : 1;
    const dt = 1 / 60;
    this.time += dt;

    const bass = props.features.bass * params.sensitivity;
    const mid = props.features.mid * params.sensitivity;
    const high = props.features.high * params.sensitivity;
    const energy = props.features.energy;

    const now = props.features.timestampMs;
    const canBurst =
      props.features.onset &&
      !props.reducedMotion &&
      now - this.lastBurstMs >= MIN_BURST_INTERVAL_MS;

    if (canBurst) {
      this.lastBurstMs = now;
      this.burstPulse = Math.min(1, params.burstStrength * photoSafe);
      const bursts = Math.floor(12 + this.burstPulse * 28);
      for (let i = 0; i < bursts; i += 1) {
        this.spawn(0, bass, mid, high, true);
      }
    } else {
      this.burstPulse *= props.reducedMotion ? 0.7 : 0.88;
    }

    // Continuous spawn rates — no arrays allocated.
    const bassSpawns = Math.min(6, Math.floor(bass * 5 * params.bassSize * motion));
    const midSpawns = Math.min(8, Math.floor(mid * 6 * params.midFlow * motion));
    const sparkleSpawns = Math.min(
      10,
      Math.floor(high * 8 * params.sparkleIntensity * motion * (0.35 + energy)),
    );

    for (let i = 0; i < bassSpawns; i += 1) this.spawn(0, bass, mid, high, false);
    for (let i = 0; i < midSpawns; i += 1) this.spawn(1, bass, mid, high, false);
    for (let i = 0; i < sparkleSpawns; i += 1) this.spawn(2, bass, mid, high, false);

    this.integrate(dt, params, motion, mid, bass);

    const hue =
      (((params.baseHue + (params.accentHue - params.baseHue) * (0.35 + high * 0.5)) % 360) + 360) %
      360;
    this.color.setHSL(hue / 360, 0.55, 0.45 + energy * 0.2 + this.burstPulse * 0.08);
    this.material.color.copy(this.color);
    this.material.opacity = 0.55 + energy * 0.3;
    this.material.size = 0.08 + bass * 0.1 * params.bassSize;

    const posAttr = this.geometry.getAttribute("position");
    const sizeAttr = this.geometry.getAttribute("size");
    posAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    this.syncDrawRange();
  }

  setQuality(tier: QualityTier): void {
    this.quality = tier;
    // Deactivate overflow particles when stepping down — no realloc.
    if (this.activeCount > this.capacity) {
      let kept = 0;
      for (let i = 0; i < MAX_POOL; i += 1) {
        if (!this.pool.active[i]) continue;
        if (kept >= this.capacity) {
          this.pool.active[i] = 0;
          continue;
        }
        kept += 1;
      }
      this.activeCount = kept;
      this.syncDrawRange();
    }
  }

  resize(width: number, height: number): void {
    void width;
    void height;
    // World-space particle field; camera handles aspect.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Test helper: active particle count. */
  getActiveCount(): number {
    return this.activeCount;
  }

  private syncDrawRange(): void {
    // Pack active particles toward the front of the attribute buffers for drawRange.
    // Positions are already updated in-place; draw the full pool capacity slice that may
    // include inactive zeros — prefer compacting indices without allocating.
    let drawCount = 0;
    const { positions, sizes, active } = this.pool;
    for (let i = 0; i < this.capacity; i += 1) {
      if (!active[i]) {
        // Park inactive points at origin with zero size so they do not contribute visually
        // if drawn; we still set drawRange to capacity for stable GPU buffers.
        const i3 = i * 3;
        positions[i3] = 0;
        positions[i3 + 1] = 0;
        positions[i3 + 2] = 0;
        sizes[i] = 0;
        continue;
      }
      drawCount += 1;
    }
    this.geometry.setDrawRange(0, this.capacity);
    void drawCount;
  }

  private spawn(kind: number, bass: number, mid: number, high: number, burst: boolean): void {
    if (this.activeCount >= this.capacity) {
      // Steal oldest slot via ring cursor — no allocation.
      let found = -1;
      for (let n = 0; n < this.capacity; n += 1) {
        const idx = (this.cursor + n) % this.capacity;
        const age = this.pool.ages[idx] ?? 0;
        const life = this.pool.lifetimes[idx] ?? 1;
        if (!this.pool.active[idx] || age > life * 0.6) {
          found = idx;
          break;
        }
      }
      if (found < 0) return;
      if (!this.pool.active[found]) this.activeCount += 1;
      this.activate(found, kind, bass, mid, high, burst);
      this.cursor = (found + 1) % this.capacity;
      return;
    }

    for (let n = 0; n < this.capacity; n += 1) {
      const idx = (this.cursor + n) % this.capacity;
      if (this.pool.active[idx]) continue;
      this.activate(idx, kind, bass, mid, high, burst);
      this.activeCount += 1;
      this.cursor = (idx + 1) % this.capacity;
      return;
    }
  }

  private activate(
    index: number,
    kind: number,
    bass: number,
    mid: number,
    high: number,
    burst: boolean,
  ): void {
    const i3 = index * 3;
    const spread = kind === 0 ? 1.8 : kind === 1 ? 2.6 : 3.2;
    // Deterministic-ish pseudo-random from index + time without allocating Math.random arrays.
    const r1 = Math.sin(index * 12.9898 + this.time * 3.1) * 43758.5453;
    const r2 = Math.sin(index * 78.233 + this.time * 1.7) * 43758.5453;
    const r3 = Math.sin(index * 45.164 + this.time * 2.3) * 43758.5453;
    const u = r1 - Math.floor(r1);
    const v = r2 - Math.floor(r2);
    const w = r3 - Math.floor(r3);

    this.pool.positions[i3] = (u - 0.5) * spread * 2;
    this.pool.positions[i3 + 1] = (v - 0.5) * spread * (kind === 0 ? 1.2 : 1.8);
    this.pool.positions[i3 + 2] = (w - 0.5) * 1.5;

    const speed = burst ? 1.8 : kind === 0 ? 0.35 + bass : kind === 1 ? 0.55 + mid : 0.9 + high;
    const angle = u * Math.PI * 2;
    this.pool.velocities[i3] = Math.cos(angle) * speed * (burst ? 1.4 : 1);
    this.pool.velocities[i3 + 1] =
      (kind === 0 ? 0.6 + bass : 0.2) * speed + (burst ? 0.8 : 0) + (v - 0.5) * 0.4;
    this.pool.velocities[i3 + 2] = Math.sin(angle) * speed * 0.35;

    this.pool.ages[index] = 0;
    this.pool.lifetimes[index] =
      kind === 2 ? 0.35 + high * 0.4 : kind === 1 ? 1.2 + mid * 0.8 : 1.8 + bass;
    this.pool.sizes[index] =
      kind === 0 ? 0.25 + bass * 0.55 : kind === 1 ? 0.1 + mid * 0.15 : 0.04 + high * 0.08;
    this.pool.kinds[index] = kind;
    this.pool.active[index] = 1;
  }

  private integrate(
    dt: number,
    params: ParticlesParams,
    motion: number,
    mid: number,
    bass: number,
  ): void {
    const flow = params.midFlow * mid * motion;
    const { positions, velocities, ages, lifetimes, sizes, kinds, active } = this.pool;

    for (let i = 0; i < this.capacity; i += 1) {
      if (!active[i]) continue;
      const age = (ages[i] ?? 0) + dt;
      ages[i] = age;
      const life = lifetimes[i] ?? 1;
      if (age >= life) {
        active[i] = 0;
        this.activeCount = Math.max(0, this.activeCount - 1);
        sizes[i] = 0;
        continue;
      }

      const i3 = i * 3;
      const kind = kinds[i] ?? 0;
      // Mid-frequency swirl field.
      if (kind === 1 || kind === 2) {
        const x = positions[i3] ?? 0;
        const z = positions[i3 + 2] ?? 0;
        velocities[i3] = (velocities[i3] ?? 0) + -z * flow * dt * 1.4;
        velocities[i3 + 2] = (velocities[i3 + 2] ?? 0) + x * flow * dt * 1.4;
      }
      if (kind === 0) {
        velocities[i3 + 1] = (velocities[i3 + 1] ?? 0) + bass * params.bassSize * dt * 0.8;
      }

      // Drag
      velocities[i3] = (velocities[i3] ?? 0) * (1 - 0.55 * dt);
      velocities[i3 + 1] = (velocities[i3 + 1] ?? 0) * (1 - 0.35 * dt) - 0.35 * dt;
      velocities[i3 + 2] = (velocities[i3 + 2] ?? 0) * (1 - 0.55 * dt);

      positions[i3] = (positions[i3] ?? 0) + (velocities[i3] ?? 0) * dt * motion;
      positions[i3 + 1] = (positions[i3 + 1] ?? 0) + (velocities[i3 + 1] ?? 0) * dt * motion;
      positions[i3 + 2] = (positions[i3 + 2] ?? 0) + (velocities[i3 + 2] ?? 0) * dt * motion;

      const lifeT = age / Math.max(life, 0.001);
      const baseSize = kind === 0 ? 0.22 + bass * 0.5 * params.bassSize : kind === 1 ? 0.1 : 0.05;
      sizes[i] = baseSize * (1 - lifeT * 0.85) * (0.7 + this.burstPulse * 0.5);
    }
  }
}

export const particlesPlugin: VisualizerPlugin = {
  id: "particles",
  label: "Particles",
  description: "Pooled particle field reactive to bass, mid, high, and beats.",
  defaultParams: { ...particlesParamsDefaults },
  paramsSchema: particlesParamsSchema,
  supportsAlbumArt: false,
  supportsDreamscapeKeyframes: false,
  preferredCamera: "perspective",
  mount(ctx) {
    return new ParticlesInstance(ctx);
  },
};

/** @internal test helper */
export function getParticlesActiveCount(instance: VisualizerInstance): number {
  if (instance instanceof ParticlesInstance) return instance.getActiveCount();
  return -1;
}

import {
  AUDIO_FEATURE_ENVELOPE_DECAY_START_MS,
  AUDIO_FEATURE_ENVELOPE_MAX_BYTES,
  AUDIO_FEATURE_ENVELOPE_SILENCE_MS,
  AUDIO_FEATURE_ENVELOPE_STALE_MS,
  audioFeatureEnvelopeSchema,
  audioFeatureEnvelopeToFrame,
  createSilentFeatureEnvelope,
  createSilentFeatureFrame,
  type AudioFeatureEnvelope,
  type AudioFeatureFrame,
} from "@prism/contracts";

import { ATTACK_COEFF, RELEASE_COEFF, smoothToward } from "./feature-math.js";

export type RemoteFeatureIngestResult =
  | { ok: true; envelope: AudioFeatureEnvelope }
  | { ok: false; reason: "invalid" | "oversized" | "stale" | "out_of_order" };

const ATTACK_TAU_MS = 22;
const RELEASE_TAU_MS = 90;

function mixScalar(current: number, target: number, dtMs: number): number {
  const tau = target > current ? ATTACK_TAU_MS : RELEASE_TAU_MS;
  const coeff = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  return current + (target - current) * coeff;
}

function copyFrame(from: AudioFeatureFrame, into: AudioFeatureFrame): void {
  into.timestampMs = from.timestampMs;
  into.rms = from.rms;
  into.peak = from.peak;
  into.bpmEstimate = from.bpmEstimate;
  into.beatPhase = from.beatPhase;
  into.energy = from.energy;
  into.onset = from.onset;
  into.bass = from.bass;
  into.mid = from.mid;
  into.high = from.high;
  const count = Math.max(into.bands.length, from.bands.length);
  if (into.bands.length !== count) {
    into.bands = Array.from({ length: count }, (_, i) => from.bands[i] ?? 0);
    return;
  }
  for (let i = 0; i < count; i += 1) {
    into.bands[i] = from.bands[i] ?? 0;
  }
}

/**
 * Smooths compact controller envelopes on a display at requestAnimationFrame rate.
 * Mutates a single frame object — no per-sample allocations.
 */
export class RemoteFeatureInterpolator {
  private readonly current: AudioFeatureFrame;
  private readonly target: AudioFeatureFrame;
  private lastReceiveMs = 0;
  private lastSampleMs = 0;
  private lastFrameSeq = -1;
  private lastTimestampMs = -1;
  private received = 0;
  private dropped = 0;

  constructor(bandCount = 32) {
    this.current = createSilentFeatureFrame(0, bandCount);
    this.target = createSilentFeatureFrame(0, bandCount);
  }

  getLastFrameSeq(): number {
    return this.lastFrameSeq;
  }

  getReceivedCount(): number {
    return this.received;
  }

  getDroppedCount(): number {
    return this.dropped;
  }

  ingest(raw: unknown, nowMs = Date.now(), payloadBytes?: number): RemoteFeatureIngestResult {
    if (typeof payloadBytes === "number" && payloadBytes > AUDIO_FEATURE_ENVELOPE_MAX_BYTES) {
      this.dropped += 1;
      return { ok: false, reason: "oversized" };
    }
    const parsed = audioFeatureEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      this.dropped += 1;
      return { ok: false, reason: "invalid" };
    }
    const envelope = parsed.data;
    if (envelope.frameSeq <= this.lastFrameSeq) {
      this.dropped += 1;
      return { ok: false, reason: "out_of_order" };
    }
    if (envelope.timestampMs + AUDIO_FEATURE_ENVELOPE_STALE_MS < nowMs) {
      this.dropped += 1;
      return { ok: false, reason: "stale" };
    }
    if (this.lastTimestampMs >= 0 && envelope.timestampMs < this.lastTimestampMs) {
      this.dropped += 1;
      return { ok: false, reason: "stale" };
    }

    const next = audioFeatureEnvelopeToFrame(envelope, this.current.bands.length);
    copyFrame(next, this.target);
    this.lastFrameSeq = envelope.frameSeq;
    this.lastTimestampMs = envelope.timestampMs;
    this.lastReceiveMs = nowMs;
    this.received += 1;
    return { ok: true, envelope };
  }

  sample(nowMs = Date.now()): AudioFeatureFrame {
    if (this.lastReceiveMs === 0) {
      this.current.timestampMs = nowMs;
      return this.current;
    }

    const dt = this.lastSampleMs === 0 ? 16 : Math.min(48, Math.max(0, nowMs - this.lastSampleMs));
    this.lastSampleMs = nowMs;
    const elapsed = nowMs - this.lastReceiveMs;

    this.current.timestampMs = nowMs;
    this.current.rms = mixScalar(this.current.rms, this.target.rms, dt);
    this.current.peak = mixScalar(this.current.peak, this.target.peak, dt);
    this.current.energy = mixScalar(this.current.energy, this.target.energy, dt);
    this.current.bass = mixScalar(this.current.bass, this.target.bass, dt);
    this.current.mid = mixScalar(this.current.mid, this.target.mid, dt);
    this.current.high = mixScalar(this.current.high, this.target.high, dt);
    this.current.beatPhase = mixScalar(this.current.beatPhase, this.target.beatPhase, dt);
    this.current.onset = this.target.onset && this.current.energy > this.target.energy * 0.5;
    this.current.bpmEstimate = this.target.bpmEstimate ?? this.current.bpmEstimate;
    const bandCount = this.current.bands.length;
    for (let i = 0; i < bandCount; i += 1) {
      this.current.bands[i] = mixScalar(this.current.bands[i] ?? 0, this.target.bands[i] ?? 0, dt);
    }

    if (elapsed <= AUDIO_FEATURE_ENVELOPE_DECAY_START_MS) {
      return this.current;
    }

    const decayWindow = AUDIO_FEATURE_ENVELOPE_SILENCE_MS - AUDIO_FEATURE_ENVELOPE_DECAY_START_MS;
    const decayT = Math.min(
      1,
      Math.max(0, (elapsed - AUDIO_FEATURE_ENVELOPE_DECAY_START_MS) / decayWindow),
    );
    const gain = 1 - decayT;
    this.current.rms *= gain;
    this.current.peak *= gain;
    this.current.energy *= gain;
    this.current.bass *= gain;
    this.current.mid *= gain;
    this.current.high *= gain;
    this.current.onset = gain > 0.2 ? this.current.onset : false;
    for (let i = 0; i < bandCount; i += 1) {
      this.current.bands[i] = (this.current.bands[i] ?? 0) * gain;
    }
    if (decayT >= 1) {
      copyFrame(createSilentFeatureFrame(nowMs, bandCount), this.target);
    }
    return this.current;
  }

  reset(): void {
    copyFrame(createSilentFeatureFrame(0, this.current.bands.length), this.current);
    copyFrame(createSilentFeatureFrame(0, this.current.bands.length), this.target);
    this.lastReceiveMs = 0;
    this.lastSampleMs = 0;
    this.lastFrameSeq = -1;
    this.lastTimestampMs = -1;
    this.received = 0;
    this.dropped = 0;
  }
}

export function silentRemoteEnvelope(frameSeq = 0, timestampMs = Date.now()): AudioFeatureEnvelope {
  return createSilentFeatureEnvelope(frameSeq, timestampMs);
}

/** @deprecated Exported for tests that previously imported the blend helper. */
export function interpolatorAttackCoeff(): number {
  return ATTACK_COEFF;
}

export function interpolatorReleaseCoeff(): number {
  return RELEASE_COEFF;
}

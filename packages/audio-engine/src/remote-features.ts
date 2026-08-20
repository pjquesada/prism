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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpFrame(from: AudioFeatureFrame, to: AudioFeatureFrame, t: number): AudioFeatureFrame {
  const amount = Math.min(1, Math.max(0, t));
  const bandCount = Math.max(from.bands.length, to.bands.length);
  const bands = Array.from({ length: bandCount }, (_, i) =>
    lerp(from.bands[i] ?? 0, to.bands[i] ?? 0, amount),
  );
  return {
    timestampMs: to.timestampMs,
    rms: lerp(from.rms, to.rms, amount),
    peak: lerp(from.peak, to.peak, amount),
    bpmEstimate: to.bpmEstimate ?? from.bpmEstimate,
    beatPhase: lerp(from.beatPhase, to.beatPhase, amount),
    bands,
    energy: lerp(from.energy, to.energy, amount),
    onset: amount > 0.5 ? to.onset : from.onset,
    bass: lerp(from.bass, to.bass, amount),
    mid: lerp(from.mid, to.mid, amount),
    high: lerp(from.high, to.high, amount),
  };
}

function scaleFrame(frame: AudioFeatureFrame, gain: number): AudioFeatureFrame {
  const g = Math.min(1, Math.max(0, gain));
  return {
    ...frame,
    rms: frame.rms * g,
    peak: frame.peak * g,
    energy: frame.energy * g,
    bass: frame.bass * g,
    mid: frame.mid * g,
    high: frame.high * g,
    onset: g > 0.2 ? frame.onset : false,
    bands: frame.bands.map((value) => value * g),
  };
}

export type RemoteFeatureIngestResult =
  | { ok: true; envelope: AudioFeatureEnvelope }
  | { ok: false; reason: "invalid" | "oversized" | "stale" | "out_of_order" };

/**
 * Smooths compact controller envelopes on a display. Decays to silence when frames stop.
 */
export class RemoteFeatureInterpolator {
  private current: AudioFeatureFrame;
  private target: AudioFeatureFrame;
  private lastReceiveMs = 0;
  private lastFrameSeq = -1;
  private lastTimestampMs = -1;
  private blend = 1;

  constructor(bandCount = 32) {
    this.current = createSilentFeatureFrame(0, bandCount);
    this.target = createSilentFeatureFrame(0, bandCount);
  }

  getLastFrameSeq(): number {
    return this.lastFrameSeq;
  }

  ingest(raw: unknown, nowMs = Date.now(), payloadBytes?: number): RemoteFeatureIngestResult {
    if (typeof payloadBytes === "number" && payloadBytes > AUDIO_FEATURE_ENVELOPE_MAX_BYTES) {
      return { ok: false, reason: "oversized" };
    }
    const parsed = audioFeatureEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, reason: "invalid" };
    }
    const envelope = parsed.data;
    if (envelope.frameSeq <= this.lastFrameSeq) {
      return { ok: false, reason: "out_of_order" };
    }
    if (envelope.timestampMs + AUDIO_FEATURE_ENVELOPE_STALE_MS < nowMs) {
      return { ok: false, reason: "stale" };
    }
    if (this.lastTimestampMs >= 0 && envelope.timestampMs < this.lastTimestampMs) {
      return { ok: false, reason: "stale" };
    }

    this.current = this.sample(nowMs);
    this.target = audioFeatureEnvelopeToFrame(envelope, this.current.bands.length);
    this.lastFrameSeq = envelope.frameSeq;
    this.lastTimestampMs = envelope.timestampMs;
    this.lastReceiveMs = nowMs;
    this.blend = 0;
    return { ok: true, envelope };
  }

  sample(nowMs = Date.now()): AudioFeatureFrame {
    const elapsed = nowMs - this.lastReceiveMs;
    if (this.lastReceiveMs === 0) {
      return createSilentFeatureFrame(nowMs, this.current.bands.length);
    }

    this.blend = Math.min(1, this.blend + 0.28);
    const mixed = lerpFrame(this.current, this.target, this.blend);

    if (elapsed <= AUDIO_FEATURE_ENVELOPE_DECAY_START_MS) {
      this.current = mixed;
      return mixed;
    }

    const decayWindow = AUDIO_FEATURE_ENVELOPE_SILENCE_MS - AUDIO_FEATURE_ENVELOPE_DECAY_START_MS;
    const decayT = Math.min(
      1,
      Math.max(0, (elapsed - AUDIO_FEATURE_ENVELOPE_DECAY_START_MS) / decayWindow),
    );
    const silenced = scaleFrame(mixed, 1 - decayT);
    this.current = silenced;
    if (decayT >= 1) {
      this.target = createSilentFeatureFrame(nowMs, this.current.bands.length);
    }
    return silenced;
  }

  reset(): void {
    this.current = createSilentFeatureFrame(0, this.current.bands.length);
    this.target = createSilentFeatureFrame(0, this.current.bands.length);
    this.lastReceiveMs = 0;
    this.lastFrameSeq = -1;
    this.lastTimestampMs = -1;
    this.blend = 1;
  }
}

export function silentRemoteEnvelope(frameSeq = 0, timestampMs = Date.now()): AudioFeatureEnvelope {
  return createSilentFeatureEnvelope(frameSeq, timestampMs);
}

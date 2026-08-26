import { audioFeatureFrameSchema, type AudioFeatureFrame } from "@prism/contracts";

import { DEFAULT_BAND_COUNT, DEFAULT_FFT_SIZE, FEATURE_INTERVAL_MS } from "./constants.js";
import {
  buildFeatureFrame,
  createFeatureExtractorState,
  type FeatureExtractorState,
} from "./feature-math.js";
import { acquireResource } from "./runtime-resources.js";

/** Keeps MediaStream graphs alive in Chromium/Edge without audible output. */
export const SILENT_OUTPUT_GAIN = 0;

export type MediaStreamTrackDiagnostics = {
  present: boolean;
  enabled: boolean;
  muted: boolean;
  readyState: MediaStreamTrackState | "none";
  settings?: MediaTrackSettings;
  constraints?: MediaTrackConstraints;
  capabilities?: MediaTrackCapabilities;
};

export type AnalysisLoopDiagnostics = {
  active: boolean;
  samplesPerSecond: number;
  framesPerSecond: number;
  currentRms: number;
  peakRms: number;
  currentEnergy: number;
};

export type MediaStreamAnalysisDiagnostics = {
  generation: number;
  audioContextState: AudioContextState | "none";
  audioContextSampleRate: number;
  fftSize: number;
  smoothingTimeConstant: number;
  track: MediaStreamTrackDiagnostics;
  loop: AnalysisLoopDiagnostics;
};

export type MediaStreamAnalysisGraphOptions = {
  fftSize?: number;
  bandCount?: number;
  smoothingTimeConstant?: number;
  validateFrames?: boolean;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  now?: () => number;
};

export type MediaStreamAnalysisSample = {
  frame: AudioFeatureFrame;
  rms: number;
  peakRms: number;
};

export type InputPipelineStageStatus = "waiting" | "healthy" | "failed" | "not_applicable";

export type InputPipelineStageDiagnostics = {
  audioTrack: InputPipelineStageStatus;
  audioContext: InputPipelineStageStatus;
  analyserSamples: InputPipelineStageStatus;
  featureExtraction: InputPipelineStageStatus;
  featurePublication: InputPipelineStageStatus;
  displayReceipt: InputPipelineStageStatus;
};

export type InputSelfTestStageResult = {
  stage: keyof InputPipelineStageDiagnostics;
  status: "pass" | "fail";
  detail: string;
};

export type InputSelfTestResult = {
  ok: boolean;
  stages: InputSelfTestStageResult[];
  peakRms: number;
  peakEnergy: number;
};

const RMS_SIGNAL_THRESHOLD = 0.008;

function defaultRaf(callback: FrameRequestCallback): number {
  return typeof window !== "undefined" ? window.requestAnimationFrame(callback) : 0;
}

function defaultCaf(handle: number): void {
  if (typeof window !== "undefined") window.cancelAnimationFrame(handle);
}

function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function describeAudioTrack(stream: MediaStream | null): MediaStreamTrackDiagnostics {
  const track = stream?.getAudioTracks()[0];
  if (!track) {
    return {
      present: false,
      enabled: false,
      muted: false,
      readyState: "none",
    };
  }
  let settings: MediaTrackSettings | undefined;
  let constraints: MediaTrackConstraints | undefined;
  let capabilities: MediaTrackCapabilities | undefined;
  try {
    settings = track.getSettings();
  } catch {
    // unavailable
  }
  try {
    constraints = track.getConstraints();
  } catch {
    // unavailable
  }
  try {
    capabilities = track.getCapabilities();
  } catch {
    // unavailable
  }
  return {
    present: true,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
    settings,
    constraints,
    capabilities,
  };
}

export function isLiveAudioTrack(stream: MediaStream | null): boolean {
  const track = stream?.getAudioTracks()[0];
  if (!track) return false;
  if (track.readyState === "ended") return false;
  if (track.enabled === false) return false;
  if (track.muted === true) return false;
  return track.readyState === "live" || track.readyState === undefined;
}

/**
 * Shared Web Audio graph for MediaStream capture and microphone analysis.
 * Routes `source → analyser → zeroGain → destination` so Chromium/Edge keep
 * pulling samples even though nothing is audible.
 */
export class MediaStreamAnalysisGraph {
  private readonly fftSize: number;
  private readonly bandCount: number;
  private readonly smoothingTimeConstant: number;
  private readonly validateFrames: boolean;
  private readonly raf: (callback: FrameRequestCallback) => number;
  private readonly caf: (handle: number) => void;
  private readonly now: () => number;

  private generation = 0;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private silentGain: GainNode | null = null;
  private frequencyBuffer: Uint8Array<ArrayBuffer> | null = null;
  private timeBuffer: Uint8Array<ArrayBuffer> | null = null;
  private extractor: FeatureExtractorState;
  private frame: AudioFeatureFrame;
  private rafId: number | null = null;
  private lastEmitMs = 0;
  private releaseContext: (() => void) | null = null;
  private releaseSource: (() => void) | null = null;
  private releaseLoop: (() => void) | null = null;
  private loopActive = false;
  private sampleTicks = 0;
  private frameTicks = 0;
  private loopStartedAtMs = 0;
  private peakRms = 0;
  private trackMutedHandler: (() => void) | null = null;
  private trackUnmutedHandler: (() => void) | null = null;
  private frameListener: ((frame: AudioFeatureFrame) => void) | null = null;

  constructor(options: MediaStreamAnalysisGraphOptions = {}) {
    this.fftSize = options.fftSize ?? DEFAULT_FFT_SIZE;
    this.bandCount = options.bandCount ?? DEFAULT_BAND_COUNT;
    this.smoothingTimeConstant = options.smoothingTimeConstant ?? 0.35;
    this.validateFrames = options.validateFrames ?? false;
    this.raf = options.requestAnimationFrame ?? defaultRaf;
    this.caf = options.cancelAnimationFrame ?? defaultCaf;
    this.now = options.now ?? defaultNow;
    this.extractor = createFeatureExtractorState(this.bandCount);
    this.frame = buildFeatureFrame(this.extractor, {
      timeDomain: new Uint8Array(this.fftSize).fill(128),
      frequencyData: new Uint8Array(this.fftSize / 2).fill(0),
      sampleRate: 44_100,
      fftSize: this.fftSize,
      timestampMs: 0,
      bandCount: this.bandCount,
    }).frame;
  }

  getGeneration(): number {
    return this.generation;
  }

  getFrame(): AudioFeatureFrame {
    return this.frame;
  }

  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  isLoopActive(): boolean {
    return this.loopActive;
  }

  setFrameListener(listener: ((frame: AudioFeatureFrame) => void) | null): void {
    this.frameListener = listener;
  }

  getDiagnostics(): MediaStreamAnalysisDiagnostics {
    const elapsedSec =
      this.loopStartedAtMs > 0 ? Math.max(0.001, (this.now() - this.loopStartedAtMs) / 1000) : 0;
    return {
      generation: this.generation,
      audioContextState: this.audioContext?.state ?? "none",
      audioContextSampleRate: this.audioContext?.sampleRate ?? 0,
      fftSize: this.analyser?.fftSize ?? this.fftSize,
      smoothingTimeConstant: this.analyser?.smoothingTimeConstant ?? this.smoothingTimeConstant,
      track: describeAudioTrack(this.stream),
      loop: {
        active: this.loopActive,
        samplesPerSecond: elapsedSec > 0 ? this.sampleTicks / elapsedSec : 0,
        framesPerSecond: elapsedSec > 0 ? this.frameTicks / elapsedSec : 0,
        currentRms: this.frame.rms,
        peakRms: this.peakRms,
        currentEnergy: this.frame.energy,
      },
    };
  }

  async connect(
    stream: MediaStream,
    audioContext: AudioContext,
    generation: number,
  ): Promise<void> {
    if (generation !== this.generation) return;
    this.stream = stream;
    this.audioContext = audioContext;
    this.sourceNode = audioContext.createMediaStreamSource(stream);
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = this.smoothingTimeConstant;
    this.silentGain = audioContext.createGain();
    this.silentGain.gain.value = SILENT_OUTPUT_GAIN;
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.silentGain);
    this.silentGain.connect(audioContext.destination);
    this.frequencyBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.timeBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.releaseContext = acquireResource("audioContexts");
    this.releaseSource = acquireResource("mediaSources");
    this.bindTrackEvents(stream, generation);
  }

  beginGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  startLoop(generation: number): void {
    if (generation !== this.generation) return;
    if (this.rafId !== null) return;
    this.loopActive = true;
    this.loopStartedAtMs = this.now();
    this.sampleTicks = 0;
    this.frameTicks = 0;
    this.releaseLoop = acquireResource("animationLoops");
    const tick = (now: number) => {
      if (generation !== this.generation) return;
      this.rafId = this.raf(tick);
      if (!this.analyser || !this.frequencyBuffer || !this.timeBuffer || !this.audioContext) return;
      this.sampleTicks += 1;
      if (now - this.lastEmitMs < FEATURE_INTERVAL_MS) return;
      this.lastEmitMs = now;
      this.frameTicks += 1;

      this.analyser.getByteFrequencyData(this.frequencyBuffer);
      this.analyser.getByteTimeDomainData(this.timeBuffer);

      const result = buildFeatureFrame(this.extractor, {
        timeDomain: this.timeBuffer,
        frequencyData: this.frequencyBuffer,
        sampleRate: this.audioContext.sampleRate,
        fftSize: this.analyser.fftSize,
        timestampMs: now,
        bandCount: this.bandCount,
      });
      this.extractor = result.state;
      this.frame = this.validateFrames ? audioFeatureFrameSchema.parse(result.frame) : result.frame;
      this.peakRms = Math.max(this.peakRms, this.frame.rms);
      this.frameListener?.(this.frame);
    };
    this.rafId = this.raf(tick);
  }

  stopLoop(): void {
    this.loopActive = false;
    if (this.rafId !== null) {
      this.caf(this.rafId);
      this.rafId = null;
    }
    this.releaseLoop?.();
    this.releaseLoop = null;
  }

  async dispose(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    this.stopLoop();
    this.unbindTrackEvents();
    this.stream = null;

    try {
      this.sourceNode?.disconnect();
    } catch {
      // already disconnected
    }
    try {
      this.analyser?.disconnect();
    } catch {
      // already disconnected
    }
    try {
      this.silentGain?.disconnect();
    } catch {
      // already disconnected
    }
    this.sourceNode = null;
    this.analyser = null;
    this.silentGain = null;
    this.frequencyBuffer = null;
    this.timeBuffer = null;
    this.releaseSource?.();
    this.releaseSource = null;
    this.releaseContext?.();
    this.releaseContext = null;
    this.audioContext = null;
  }

  private bindTrackEvents(stream: MediaStream, generation: number): void {
    this.unbindTrackEvents();
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    const onChange = () => {
      if (generation !== this.generation) return;
      // Track state is read lazily via getDiagnostics(); no sample logging.
    };
    this.trackMutedHandler = onChange;
    this.trackUnmutedHandler = onChange;
    track.addEventListener("mute", onChange);
    track.addEventListener("unmute", onChange);
  }

  private unbindTrackEvents(): void {
    const track = this.stream?.getAudioTracks()[0];
    if (!track) {
      this.trackMutedHandler = null;
      this.trackUnmutedHandler = null;
      return;
    }
    if (this.trackMutedHandler) track.removeEventListener("mute", this.trackMutedHandler);
    if (this.trackUnmutedHandler) track.removeEventListener("unmute", this.trackUnmutedHandler);
    this.trackMutedHandler = null;
    this.trackUnmutedHandler = null;
  }
}

export type MediaStreamSelfTestOptions = {
  createContext?: () => AudioContext | null;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  now?: () => number;
  publish?: (frame: AudioFeatureFrame) => boolean;
  observeDisplay?: () => number;
};

/**
 * Exercises the production MediaStream analyser graph with a local synthetic signal.
 * Produces no audible output and never transmits PCM/FFT arrays.
 */
export async function runMediaStreamInputSelfTest(
  options: MediaStreamSelfTestOptions = {},
): Promise<InputSelfTestResult> {
  const stages: InputSelfTestStageResult[] = [];
  const createContext =
    options.createContext ??
    (() => {
      if (typeof window === "undefined") return null;
      const Ctor = window.AudioContext;
      try {
        return new Ctor();
      } catch {
        return null;
      }
    });
  const raf = options.requestAnimationFrame ?? defaultRaf;
  const caf = options.cancelAnimationFrame ?? defaultCaf;
  const now = options.now ?? defaultNow;

  const context = createContext();
  if (!context) {
    stages.push({
      stage: "audioContext",
      status: "fail",
      detail: "Web Audio API unavailable",
    });
    return { ok: false, stages, peakRms: 0, peakEnergy: 0 };
  }

  try {
    if (context.state === "suspended") await context.resume();
  } catch {
    stages.push({
      stage: "audioContext",
      status: "fail",
      detail: "AudioContext could not resume",
    });
    await context.close().catch(() => undefined);
    return { ok: false, stages, peakRms: 0, peakEnergy: 0 };
  }

  stages.push({
    stage: "audioContext",
    status: context.state === "running" ? "pass" : "fail",
    detail: `state=${context.state}`,
  });

  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = 440;
  oscillator.connect(destination);
  oscillator.start();

  const stream = destination.stream;
  stages.push({
    stage: "audioTrack",
    status: stream.getAudioTracks().length > 0 ? "pass" : "fail",
    detail: `tracks=${stream.getAudioTracks().length}`,
  });

  const graph = new MediaStreamAnalysisGraph({
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
    now,
  });
  const generation = graph.beginGeneration();
  await graph.connect(stream, context, generation);
  graph.startLoop(generation);

  let peakRms = 0;
  let peakEnergy = 0;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 120);
  });

  const frame = graph.getFrame();
  peakRms = frame.rms;
  peakEnergy = frame.energy;
  stages.push({
    stage: "analyserSamples",
    status: peakRms >= RMS_SIGNAL_THRESHOLD ? "pass" : "fail",
    detail: `peakRms=${peakRms.toFixed(4)}`,
  });
  stages.push({
    stage: "featureExtraction",
    status: peakEnergy > 0 ? "pass" : "fail",
    detail: `peakEnergy=${peakEnergy.toFixed(4)}`,
  });

  let published = false;
  if (options.publish) {
    published = options.publish(frame);
    stages.push({
      stage: "featurePublication",
      status: published ? "pass" : "fail",
      detail: published ? "envelope accepted" : "publication rejected",
    });
  } else {
    stages.push({
      stage: "featurePublication",
      status: "pass",
      detail: "not exercised",
    });
  }

  const displayCount = options.observeDisplay?.() ?? 0;
  stages.push({
    stage: "displayReceipt",
    status: options.observeDisplay ? (displayCount > 0 ? "pass" : "fail") : "pass",
    detail: options.observeDisplay ? `frames=${displayCount}` : "not exercised",
  });

  oscillator.stop();
  graph.stopLoop();
  await graph.dispose(generation);
  await context.close().catch(() => undefined);

  const ok = stages.every((stage) => stage.status === "pass");
  return { ok, stages, peakRms, peakEnergy };
}

export function derivePipelineStageDiagnostics(input: {
  track: MediaStreamTrackDiagnostics;
  audioContextState: AudioContextState | "none";
  loopActive: boolean;
  currentRms: number;
  currentEnergy: number;
  envelopesPublishedPerSecond?: number;
  envelopesReceivedPerSecond?: number;
  publicationHealthy?: boolean;
  displayReceiptHealthy?: boolean;
}): InputPipelineStageDiagnostics {
  const trackHealthy =
    input.track.present &&
    input.track.readyState === "live" &&
    input.track.enabled &&
    !input.track.muted;
  const contextHealthy = input.audioContextState === "running";
  const samplesHealthy = input.loopActive && input.currentRms >= RMS_SIGNAL_THRESHOLD;
  const extractionHealthy = input.currentEnergy > 0;
  const publicationHealthy =
    input.publicationHealthy ??
    (input.envelopesPublishedPerSecond !== undefined
      ? input.envelopesPublishedPerSecond > 0
      : false);
  const displayHealthy =
    input.displayReceiptHealthy ??
    (input.envelopesReceivedPerSecond !== undefined ? input.envelopesReceivedPerSecond > 0 : false);

  return {
    audioTrack: trackHealthy ? "healthy" : input.track.present ? "waiting" : "failed",
    audioContext: contextHealthy
      ? "healthy"
      : input.audioContextState === "none"
        ? "waiting"
        : "failed",
    analyserSamples: samplesHealthy
      ? "healthy"
      : input.loopActive
        ? "waiting"
        : input.track.present
          ? "failed"
          : "not_applicable",
    featureExtraction: extractionHealthy
      ? "healthy"
      : input.loopActive
        ? "waiting"
        : "not_applicable",
    featurePublication: publicationHealthy
      ? "healthy"
      : publicationHealthy === false
        ? "waiting"
        : "not_applicable",
    displayReceipt:
      input.envelopesReceivedPerSecond === undefined
        ? "not_applicable"
        : displayHealthy
          ? "healthy"
          : "waiting",
  };
}

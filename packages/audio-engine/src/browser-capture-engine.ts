import { audioFeatureFrameSchema, type AudioFeatureFrame, type AudioMode } from "@prism/contracts";

import { createAudioContext, isSecureAudioContext } from "./audio-context.js";
import { DEFAULT_BAND_COUNT, DEFAULT_FFT_SIZE, FEATURE_INTERVAL_MS } from "./constants.js";
import {
  buildBrowserCaptureConstraints,
  canRequestBrowserCapture,
  classifyGetDisplayMediaError,
  discardCapturedVideoTracks,
  NO_AUDIO_SHARED_MESSAGE,
  stopDisplayMediaStream,
  streamHasAudioTrack,
  type BrowserCaptureFailureStatus,
} from "./display-media.js";
import {
  buildFeatureFrame,
  createFeatureExtractorState,
  silentFrame,
  type FeatureExtractorState,
} from "./feature-math.js";
import { acquireResource } from "./runtime-resources.js";

export const BROWSER_CAPTURE_SOUND_THRESHOLD = 0.035;

export type BrowserCaptureEngineStatus =
  | "idle"
  | "requesting"
  | "waiting"
  | "listening"
  | "no_audio"
  | "ended"
  | "paused"
  | "denied"
  | "unsupported"
  | "inactive"
  | "error";

export type BrowserCaptureEngineOptions = {
  fftSize?: number;
  bandCount?: number;
  validateFrames?: boolean;
  getDisplayMedia?: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
  createContext?: () => AudioContext | null;
  isSecureContext?: () => boolean;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  now?: () => number;
};

export type BrowserCaptureEngineListener = (event: {
  status: BrowserCaptureEngineStatus;
  frame: AudioFeatureFrame;
  errorMessage?: string;
}) => void;

/**
 * Controller-only browser/system audio capture via getDisplayMedia.
 * Analyzes the audio track locally with Web Audio. Never connects to speakers,
 * never uses MediaRecorder, never transmits MediaStream / PCM / video.
 */
export class BrowserCaptureEngine {
  readonly mode: AudioMode = "live_listen";

  private readonly fftSize: number;
  private readonly bandCount: number;
  private readonly validateFrames: boolean;
  private readonly getDisplayMedia: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
  private readonly createContext: () => AudioContext | null;
  private readonly isSecure: () => boolean;
  private readonly raf: (callback: FrameRequestCallback) => number;
  private readonly caf: (handle: number) => void;
  private readonly now: () => number;
  private readonly listeners = new Set<BrowserCaptureEngineListener>();

  private status: BrowserCaptureEngineStatus = "idle";
  private errorMessage: string | undefined;
  private frame: AudioFeatureFrame;
  private extractor: FeatureExtractorState;

  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frequencyBuffer: Uint8Array<ArrayBuffer> | null = null;
  private timeBuffer: Uint8Array<ArrayBuffer> | null = null;
  private rafId: number | null = null;
  private lastEmitMs = 0;
  private disposed = false;
  private contextStateHandler: (() => void) | null = null;
  private trackEndedHandler: (() => void) | null = null;
  private releaseContext: (() => void) | null = null;
  private releaseSource: (() => void) | null = null;
  private releaseLoop: (() => void) | null = null;

  constructor(options: BrowserCaptureEngineOptions = {}) {
    this.fftSize = options.fftSize ?? DEFAULT_FFT_SIZE;
    this.bandCount = options.bandCount ?? DEFAULT_BAND_COUNT;
    this.validateFrames = options.validateFrames ?? false;
    this.getDisplayMedia =
      options.getDisplayMedia ??
      ((constraints) => {
        const devices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
        if (!devices?.getDisplayMedia) {
          return Promise.reject(new Error("getDisplayMedia is not available."));
        }
        return devices.getDisplayMedia(constraints);
      });
    this.createContext = options.createContext ?? createAudioContext;
    this.isSecure = options.isSecureContext ?? isSecureAudioContext;
    this.raf =
      options.requestAnimationFrame ??
      ((callback) => (typeof window !== "undefined" ? window.requestAnimationFrame(callback) : 0));
    this.caf =
      options.cancelAnimationFrame ??
      ((handle) => {
        if (typeof window !== "undefined") window.cancelAnimationFrame(handle);
      });
    this.now =
      options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.frame = silentFrame(0, this.bandCount);
    this.extractor = createFeatureExtractorState(this.bandCount);
  }

  getStatus(): BrowserCaptureEngineStatus {
    return this.status;
  }

  getFrame(): AudioFeatureFrame {
    return this.frame;
  }

  getErrorMessage(): string | undefined {
    return this.errorMessage;
  }

  subscribe(listener: BrowserCaptureEngineListener): () => void {
    this.listeners.add(listener);
    listener({ status: this.status, frame: this.frame, errorMessage: this.errorMessage });
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    if (
      this.status === "requesting" ||
      this.status === "waiting" ||
      this.status === "listening"
    ) {
      return;
    }

    if (this.status === "paused" && this.analyser && this.stream) {
      const context = this.audioContext;
      if (context?.state === "suspended") {
        try {
          await context.resume();
        } catch {
          this.setFailure("inactive", "Audio context is inactive. Click Capture Music again.");
          return;
        }
      }
      if (context && context.state !== "running") {
        this.setFailure("inactive", "Audio context is inactive. Click Capture Music again.");
        return;
      }
      this.setStatus(this.frame.energy >= BROWSER_CAPTURE_SOUND_THRESHOLD ? "listening" : "waiting");
      this.startLoop();
      return;
    }

    const devices = typeof navigator !== "undefined" ? (navigator.mediaDevices ?? null) : null;
    if (!canRequestBrowserCapture(devices ?? { getDisplayMedia: this.getDisplayMedia }, this.isSecure())) {
      this.setFailure(
        "unsupported",
        "Browser/system audio capture is unavailable here. Prefer Chrome or Edge on desktop, or use Microphone / Demo Track.",
      );
      return;
    }

    this.setStatus("requesting");

    // Invoke getDisplayMedia and AudioContext before any await so the user gesture stays valid.
    let streamPromise: Promise<MediaStream>;
    try {
      streamPromise = this.getDisplayMedia(buildBrowserCaptureConstraints());
    } catch (error) {
      const failure = classifyGetDisplayMediaError(error);
      this.setFailure(failure.status, failure.message);
      return;
    }

    const nextContext = this.createContext();
    const resumePromise =
      nextContext?.state === "suspended" ? nextContext.resume() : Promise.resolve();

    await this.tearDownGraph({ keepStatus: true });
    this.audioContext = nextContext;

    try {
      await resumePromise;
    } catch {
      stopDisplayMediaStream(await streamPromise.catch(() => null));
      this.setFailure("inactive", "Audio context is inactive. Click Capture Music again.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await streamPromise;
    } catch (error) {
      const failure = classifyGetDisplayMediaError(error);
      this.setFailure(failure.status, failure.message);
      return;
    }

    if (this.disposed) {
      stopDisplayMediaStream(stream);
      return;
    }

    // Never render, encode, or retain video — discard immediately.
    discardCapturedVideoTracks(stream);

    if (!streamHasAudioTrack(stream)) {
      stopDisplayMediaStream(stream);
      this.setFailure("no_audio", NO_AUDIO_SHARED_MESSAGE);
      return;
    }

    if (!this.audioContext) {
      stopDisplayMediaStream(stream);
      this.setFailure("unsupported", "Web Audio API is not available in this browser.");
      return;
    }

    if (this.audioContext.state !== "running") {
      stopDisplayMediaStream(stream);
      this.setFailure("inactive", "Audio context is inactive. Click Capture Music again.");
      return;
    }

    this.stream = stream;

    try {
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.35;
      // Intentionally not connected to destination — source app already plays audio.
      this.sourceNode.connect(this.analyser);
      this.frequencyBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.timeBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      this.releaseContext = acquireResource("audioContexts");
      this.releaseSource = acquireResource("mediaSources");
      this.bindContextState(this.audioContext);
      this.bindTrackEnded(this.stream);
    } catch {
      await this.tearDownGraph({ keepStatus: true });
      this.setFailure("error", "Could not start Capture Music. Try again or use Microphone / Demo Track.");
      return;
    }

    this.setStatus("waiting");
    this.startLoop();
  }

  async pause(): Promise<void> {
    if (this.status !== "waiting" && this.status !== "listening") return;
    this.stopLoop();
    this.setStatus("paused");
  }

  /** Stop capture tracks and close audio resources. Does not auto-restart. */
  async stop(): Promise<void> {
    await this.tearDownGraph({ keepStatus: true });
    if (this.status !== "ended" && this.status !== "no_audio" && this.status !== "denied") {
      this.setStatus("ended");
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.tearDownGraph({ keepStatus: true });
    this.listeners.clear();
    this.status = "idle";
    this.errorMessage = undefined;
    this.frame = silentFrame(this.now(), this.bandCount);
  }

  private async tearDownGraph(options?: { keepStatus?: boolean }): Promise<void> {
    this.stopLoop();
    this.unbindContextState();
    this.unbindTrackEnded();
    stopDisplayMediaStream(this.stream);
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
    this.sourceNode = null;
    this.analyser = null;
    this.frequencyBuffer = null;
    this.timeBuffer = null;
    this.releaseSource?.();
    this.releaseSource = null;
    this.releaseContext?.();
    this.releaseContext = null;

    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        // ignore close races
      }
      this.audioContext = null;
    }

    if (!options?.keepStatus && !this.disposed) {
      this.frame = silentFrame(this.now(), this.bandCount);
    }
  }

  private bindTrackEnded(stream: MediaStream): void {
    this.unbindTrackEnded();
    const handler = () => {
      if (this.disposed) return;
      const alive = streamHasAudioTrack(stream);
      if (alive) return;
      void this.tearDownGraph({ keepStatus: true }).then(() => {
        if (this.disposed) return;
        this.setFailure("ended", "Sharing stopped. Click Capture Music to choose a music source again.");
      });
    };
    this.trackEndedHandler = handler;
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", handler);
    }
  }

  private unbindTrackEnded(): void {
    if (this.stream && this.trackEndedHandler) {
      for (const track of this.stream.getAudioTracks()) {
        try {
          track.removeEventListener("ended", this.trackEndedHandler);
        } catch {
          // ignore
        }
      }
    }
    this.trackEndedHandler = null;
  }

  private bindContextState(context: AudioContext): void {
    this.unbindContextState();
    const handler = () => {
      if (this.disposed) return;
      if (this.status !== "waiting" && this.status !== "listening") return;
      const state = this.audioContext?.state as string | undefined;
      if (state === "suspended" || state === "interrupted") {
        this.setFailure("inactive", "Audio context is inactive. Click Capture Music again.");
      }
    };
    this.contextStateHandler = handler;
    context.addEventListener("statechange", handler);
  }

  private unbindContextState(): void {
    if (this.audioContext && this.contextStateHandler) {
      try {
        this.audioContext.removeEventListener("statechange", this.contextStateHandler);
      } catch {
        // ignore
      }
    }
    this.contextStateHandler = null;
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    this.releaseLoop = acquireResource("animationLoops");
    const tick = (now: number) => {
      this.rafId = this.raf(tick);
      if (!this.analyser || !this.frequencyBuffer || !this.timeBuffer || !this.audioContext) return;
      if (now - this.lastEmitMs < FEATURE_INTERVAL_MS) return;
      this.lastEmitMs = now;

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

      if (this.status === "waiting" || this.status === "listening") {
        const next =
          this.frame.energy >= BROWSER_CAPTURE_SOUND_THRESHOLD ? "listening" : "waiting";
        if (next !== this.status) {
          this.status = next;
          this.errorMessage = undefined;
        }
      }
      this.emit();
    };
    this.rafId = this.raf(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      this.caf(this.rafId);
      this.rafId = null;
    }
    this.releaseLoop?.();
    this.releaseLoop = null;
  }

  private setStatus(status: BrowserCaptureEngineStatus): void {
    this.status = status;
    if (status === "waiting" || status === "listening") {
      this.errorMessage = undefined;
    }
    if (status !== "waiting" && status !== "listening") {
      this.frame = silentFrame(this.now(), this.bandCount);
    }
    this.emit();
  }

  private setFailure(status: BrowserCaptureFailureStatus, message: string): void {
    this.status = status;
    this.errorMessage = message;
    this.frame = silentFrame(this.now(), this.bandCount);
    this.emit();
  }

  private emit(): void {
    const payload = {
      status: this.status,
      frame: this.frame,
      errorMessage: this.errorMessage,
    };
    for (const listener of this.listeners) {
      listener(payload);
    }
  }
}

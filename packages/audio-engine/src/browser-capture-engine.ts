import { type AudioFeatureFrame, type AudioMode } from "@prism/contracts";

import { createAudioContext, isSecureAudioContext } from "./audio-context.js";
import { DEFAULT_BAND_COUNT, DEFAULT_FFT_SIZE } from "./constants.js";
import {
  buildBrowserCaptureConstraints,
  canRequestBrowserCapture,
  classifyGetDisplayMediaError,
  NO_AUDIO_SHARED_MESSAGE,
  stopDisplayMediaStream,
  streamHasAudioTrack,
  type BrowserCaptureFailureStatus,
} from "./display-media.js";
import { silentFrame } from "./feature-math.js";
import { isLiveAudioTrack, MediaStreamAnalysisGraph } from "./media-stream-analysis.js";

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
 * Analyzes the audio track locally with Web Audio. Never connects capture to speakers,
 * never uses MediaRecorder, never transmits MediaStream / PCM / video.
 */
export class BrowserCaptureEngine {
  readonly mode: AudioMode = "live_listen";

  private readonly bandCount: number;
  private readonly validateFrames: boolean;
  private readonly getDisplayMedia: (
    constraints: DisplayMediaStreamOptions,
  ) => Promise<MediaStream>;
  private readonly createContext: () => AudioContext | null;
  private readonly isSecure: () => boolean;
  private readonly now: () => number;
  private readonly listeners = new Set<BrowserCaptureEngineListener>();
  private readonly graph: MediaStreamAnalysisGraph;

  private status: BrowserCaptureEngineStatus = "idle";
  private errorMessage: string | undefined;
  private frame: AudioFeatureFrame;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private captureGeneration = 0;
  private disposed = false;
  private contextStateHandler: (() => void) | null = null;
  private trackEndedHandler: (() => void) | null = null;

  constructor(options: BrowserCaptureEngineOptions = {}) {
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
    this.now =
      options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.graph = new MediaStreamAnalysisGraph({
      fftSize: options.fftSize ?? DEFAULT_FFT_SIZE,
      bandCount: this.bandCount,
      validateFrames: this.validateFrames,
      requestAnimationFrame: options.requestAnimationFrame,
      cancelAnimationFrame: options.cancelAnimationFrame,
      now: this.now,
    });
    this.frame = silentFrame(0, this.bandCount);
  }

  getStatus(): BrowserCaptureEngineStatus {
    return this.status;
  }

  getFrame(): AudioFeatureFrame {
    return this.graph.getStream() ? this.graph.getFrame() : this.frame;
  }

  getErrorMessage(): string | undefined {
    return this.errorMessage;
  }

  getAnalysisGraph(): MediaStreamAnalysisGraph {
    return this.graph;
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
    if (this.status === "requesting" || this.status === "waiting" || this.status === "listening") {
      return;
    }

    if (this.status === "paused" && this.graph.getStream()) {
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
      const gen = this.graph.getGeneration();
      this.setStatus(
        this.frame.energy >= BROWSER_CAPTURE_SOUND_THRESHOLD ? "listening" : "waiting",
      );
      this.graph.startLoop(gen);
      return;
    }

    const devices = typeof navigator !== "undefined" ? (navigator.mediaDevices ?? null) : null;
    if (
      !canRequestBrowserCapture(
        devices ?? { getDisplayMedia: this.getDisplayMedia },
        this.isSecure(),
      )
    ) {
      this.setFailure(
        "unsupported",
        "Browser/system audio capture is unavailable here. Prefer Chrome or Edge on desktop, or use Microphone / Demo Track.",
      );
      return;
    }

    const oldGen = this.graph.getGeneration();
    await this.disposeCapture(oldGen, { keepStatus: true });
    const gen = this.graph.beginGeneration();
    this.captureGeneration = gen;
    this.setStatus("requesting");

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

    if (gen !== this.captureGeneration) return;

    this.audioContext = nextContext;

    try {
      await resumePromise;
    } catch {
      stopDisplayMediaStream(await streamPromise.catch(() => null));
      if (gen !== this.captureGeneration) return;
      this.setFailure("inactive", "Audio context is inactive. Click Capture Music again.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await streamPromise;
    } catch (error) {
      if (gen !== this.captureGeneration) return;
      const failure = classifyGetDisplayMediaError(error);
      this.setFailure(failure.status, failure.message);
      return;
    }

    if (this.disposed || gen !== this.captureGeneration) {
      stopDisplayMediaStream(stream);
      return;
    }

    // Keep the browser-required display video track alive for the lifetime of
    // capture. Prism never reads or renders it; stopping it here can terminate
    // the coupled tab-capture session (including audio) in Chromium/Edge.

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
      await this.graph.connect(stream, this.audioContext, gen);
      if (gen !== this.captureGeneration) {
        stopDisplayMediaStream(stream);
        this.stream = null;
        return;
      }
      this.bindContextState(this.audioContext, gen);
      this.bindTrackEnded(stream, gen);
      this.graph.setFrameListener((frame) => this.handleAnalysisFrame(frame));
    } catch {
      if (gen !== this.captureGeneration) return;
      await this.disposeCapture(gen, { keepStatus: true });
      this.setFailure(
        "error",
        "Could not start Capture Music. Try again or use Microphone / Demo Track.",
      );
      return;
    }

    this.setStatus("waiting");
    this.graph.startLoop(gen);
  }

  async pause(): Promise<void> {
    if (this.status !== "waiting" && this.status !== "listening") return;
    this.graph.stopLoop();
    this.setStatus("paused");
  }

  async stop(): Promise<void> {
    const gen = this.captureGeneration;
    await this.disposeCapture(gen, { keepStatus: true });
    if (this.status !== "ended" && this.status !== "no_audio" && this.status !== "denied") {
      this.setStatus("ended");
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const gen = this.captureGeneration;
    await this.disposeCapture(gen, { keepStatus: true });
    this.listeners.clear();
    this.status = "idle";
    this.errorMessage = undefined;
    this.frame = silentFrame(this.now(), this.bandCount);
  }

  private async disposeCapture(
    generation: number,
    options?: { keepStatus?: boolean },
  ): Promise<void> {
    this.graph.setFrameListener(null);
    this.unbindContextState();
    this.unbindTrackEnded();
    stopDisplayMediaStream(this.stream);
    this.stream = null;
    await this.graph.dispose(generation);

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

  private bindTrackEnded(stream: MediaStream, generation: number): void {
    this.unbindTrackEnded();
    const handler = () => {
      if (this.disposed || generation !== this.captureGeneration) return;
      if (streamHasAudioTrack(stream)) return;
      this.setFailure(
        "ended",
        "Sharing stopped. Click Capture Music to choose a music source again.",
      );
      void this.disposeCapture(generation, { keepStatus: true });
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

  private bindContextState(context: AudioContext, generation: number): void {
    this.unbindContextState();
    const handler = () => {
      if (this.disposed || generation !== this.captureGeneration) return;
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

  private handleAnalysisFrame(frame: AudioFeatureFrame): void {
    this.frame = frame;
    if (this.status === "waiting" || this.status === "listening") {
      const next =
        frame.energy >= BROWSER_CAPTURE_SOUND_THRESHOLD && isLiveAudioTrack(this.stream)
          ? "listening"
          : "waiting";
      if (next !== this.status) {
        this.status = next;
        this.errorMessage = undefined;
      }
    }
    this.emit();
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

import { type AudioFeatureFrame, type AudioMode } from "@prism/contracts";

import { createAudioContext, isSecureAudioContext } from "./audio-context.js";
import { DEFAULT_BAND_COUNT, DEFAULT_FFT_SIZE } from "./constants.js";
import { silentFrame } from "./feature-math.js";
import {
  LIVE_LISTEN_AUDIO_CONSTRAINTS,
  canRequestMicrophone,
  classifyGetUserMediaError,
  stopMediaStream,
  type LiveListenFailureStatus,
} from "./media-permission.js";
import { isLiveAudioTrack, MediaStreamAnalysisGraph } from "./media-stream-analysis.js";

export const LIVE_LISTEN_SOUND_THRESHOLD = 0.035;

export type LiveListenEngineStatus =
  | "idle"
  | "requesting"
  | "listening"
  | "waiting"
  | "paused"
  | "denied"
  | "unavailable"
  | "unsupported"
  | "inactive"
  | "error";

export type LiveListenEngineOptions = {
  fftSize?: number;
  bandCount?: number;
  validateFrames?: boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createContext?: () => AudioContext | null;
  isSecureContext?: () => boolean;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  now?: () => number;
};

export type LiveListenEngineListener = (event: {
  status: LiveListenEngineStatus;
  frame: AudioFeatureFrame;
  errorMessage?: string;
}) => void;

/**
 * On-device microphone analysis. Numeric feature frames only.
 * Never records, saves, or transmits PCM / MediaStream audio.
 */
export class LiveListenEngine {
  readonly mode: AudioMode = "live_listen";

  private readonly bandCount: number;
  private readonly validateFrames: boolean;
  private readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly createContext: () => AudioContext | null;
  private readonly isSecure: () => boolean;
  private readonly now: () => number;
  private readonly listeners = new Set<LiveListenEngineListener>();
  private readonly graph: MediaStreamAnalysisGraph;

  private status: LiveListenEngineStatus = "idle";
  private errorMessage: string | undefined;
  private frame: AudioFeatureFrame;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private captureGeneration = 0;
  private disposed = false;
  private contextStateHandler: (() => void) | null = null;

  constructor(options: LiveListenEngineOptions = {}) {
    this.bandCount = options.bandCount ?? DEFAULT_BAND_COUNT;
    this.validateFrames = options.validateFrames ?? false;
    this.getUserMedia =
      options.getUserMedia ??
      ((constraints) => {
        const devices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
        if (!devices?.getUserMedia) {
          return Promise.reject(new Error("getUserMedia is not available."));
        }
        return devices.getUserMedia(constraints);
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

  getStatus(): LiveListenEngineStatus {
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

  subscribe(listener: LiveListenEngineListener): () => void {
    this.listeners.add(listener);
    listener({ status: this.status, frame: this.frame, errorMessage: this.errorMessage });
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    if (this.status === "listening" || this.status === "waiting" || this.status === "requesting") {
      return;
    }

    if (this.status === "paused" && this.graph.getStream()) {
      const context = this.audioContext;
      if (context?.state === "suspended") {
        try {
          await context.resume();
        } catch {
          this.setFailure("inactive", "Audio context is inactive. Tap Microphone again.");
          return;
        }
      }
      if (context && context.state !== "running") {
        this.setFailure("inactive", "Audio context is inactive. Tap Microphone again.");
        return;
      }
      const gen = this.graph.getGeneration();
      this.setStatus(this.frame.energy >= LIVE_LISTEN_SOUND_THRESHOLD ? "listening" : "waiting");
      this.graph.startLoop(gen);
      return;
    }

    const devices = typeof navigator !== "undefined" ? (navigator.mediaDevices ?? null) : null;
    if (!canRequestMicrophone(devices ?? { getUserMedia: this.getUserMedia }, this.isSecure())) {
      this.setFailure("unsupported", "Microphone access requires a secure browser context.");
      return;
    }

    const oldGen = this.graph.getGeneration();
    await this.disposeCapture(oldGen);
    const gen = this.graph.beginGeneration();
    this.captureGeneration = gen;
    this.setStatus("requesting");

    let streamPromise: Promise<MediaStream>;
    try {
      streamPromise = this.getUserMedia(LIVE_LISTEN_AUDIO_CONSTRAINTS);
    } catch (error) {
      const failure = classifyGetUserMediaError(error);
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
      stopMediaStream(await streamPromise.catch(() => null));
      if (gen !== this.captureGeneration) return;
      this.setFailure("inactive", "Audio context is inactive. Tap Microphone again.");
      return;
    }

    try {
      this.stream = await streamPromise;
    } catch (error) {
      if (gen !== this.captureGeneration) return;
      const failure = classifyGetUserMediaError(error);
      this.setFailure(failure.status, failure.message);
      return;
    }

    if (this.disposed || gen !== this.captureGeneration) {
      stopMediaStream(this.stream);
      this.stream = null;
      return;
    }

    if (!this.audioContext || !this.stream) {
      stopMediaStream(this.stream);
      this.stream = null;
      this.setFailure("unsupported", "Web Audio API is not available in this browser.");
      return;
    }

    if (this.audioContext.state !== "running") {
      stopMediaStream(this.stream);
      this.stream = null;
      this.setFailure("inactive", "Audio context is inactive. Tap Microphone again.");
      return;
    }

    try {
      await this.graph.connect(this.stream, this.audioContext, gen);
      if (gen !== this.captureGeneration) {
        stopMediaStream(this.stream);
        this.stream = null;
        return;
      }
      this.bindContextState(this.audioContext, gen);
      this.graph.setFrameListener((frame) => this.handleAnalysisFrame(frame));
    } catch {
      if (gen !== this.captureGeneration) return;
      await this.disposeCapture(gen);
      this.setFailure("error", "Could not start microphone capture. Try again or use Demo Track.");
      return;
    }

    this.setStatus("waiting");
    this.graph.startLoop(gen);
  }

  async pause(): Promise<void> {
    if (this.status !== "listening" && this.status !== "waiting") return;
    this.graph.stopLoop();
    this.setStatus("paused");
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const gen = this.captureGeneration;
    await this.disposeCapture(gen);
    this.listeners.clear();
    this.status = "idle";
    this.errorMessage = undefined;
    this.frame = silentFrame(this.now(), this.bandCount);
  }

  private async disposeCapture(generation: number): Promise<void> {
    this.graph.setFrameListener(null);
    this.unbindContextState();
    stopMediaStream(this.stream);
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
  }

  private bindContextState(context: AudioContext, generation: number): void {
    this.unbindContextState();
    const handler = () => {
      if (this.disposed || generation !== this.captureGeneration) return;
      if (this.status !== "listening" && this.status !== "waiting") return;
      const state = this.audioContext?.state as string | undefined;
      if (state === "suspended" || state === "interrupted") {
        this.setFailure("inactive", "Audio context is inactive. Tap Microphone again.");
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
        frame.energy >= LIVE_LISTEN_SOUND_THRESHOLD && isLiveAudioTrack(this.stream)
          ? "listening"
          : "waiting";
      if (next !== this.status) {
        this.status = next;
        this.errorMessage = undefined;
      }
    }
    this.emit();
  }

  private setStatus(status: LiveListenEngineStatus): void {
    this.status = status;
    if (status === "listening" || status === "waiting") {
      this.errorMessage = undefined;
    }
    if (status !== "listening" && status !== "waiting") {
      this.frame = silentFrame(this.now(), this.bandCount);
    }
    this.emit();
  }

  private setFailure(status: LiveListenFailureStatus, message: string): void {
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

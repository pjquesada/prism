import { audioFeatureFrameSchema, type AudioFeatureFrame, type AudioMode } from "@prism/contracts";

import { createAudioContext, isSecureAudioContext } from "./audio-context.js";
import { DEFAULT_BAND_COUNT, DEFAULT_FFT_SIZE, FEATURE_INTERVAL_MS } from "./constants.js";
import {
  buildFeatureFrame,
  createFeatureExtractorState,
  silentFrame,
  type FeatureExtractorState,
} from "./feature-math.js";
import {
  LIVE_LISTEN_AUDIO_CONSTRAINTS,
  canRequestMicrophone,
  classifyGetUserMediaError,
  stopMediaStream,
  type LiveListenFailureStatus,
} from "./media-permission.js";

export type LiveListenEngineStatus =
  | "idle"
  | "requesting"
  | "listening"
  | "paused"
  | "denied"
  | "unavailable"
  | "unsupported"
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

  private readonly fftSize: number;
  private readonly bandCount: number;
  private readonly validateFrames: boolean;
  private readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly createContext: () => AudioContext | null;
  private readonly isSecure: () => boolean;
  private readonly raf: (callback: FrameRequestCallback) => number;
  private readonly caf: (handle: number) => void;
  private readonly now: () => number;
  private readonly listeners = new Set<LiveListenEngineListener>();

  private status: LiveListenEngineStatus = "idle";
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

  constructor(options: LiveListenEngineOptions = {}) {
    this.fftSize = options.fftSize ?? DEFAULT_FFT_SIZE;
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

  getStatus(): LiveListenEngineStatus {
    return this.status;
  }

  getFrame(): AudioFeatureFrame {
    return this.frame;
  }

  getErrorMessage(): string | undefined {
    return this.errorMessage;
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
    if (this.status === "listening" || this.status === "requesting") return;

    if (this.status === "paused" && this.analyser && this.stream) {
      this.setStatus("listening");
      this.startLoop();
      return;
    }

    await this.tearDownGraph();

    const devices = typeof navigator !== "undefined" ? (navigator.mediaDevices ?? null) : null;
    if (!canRequestMicrophone(devices ?? { getUserMedia: this.getUserMedia }, this.isSecure())) {
      this.setFailure("unsupported", "Microphone access requires a secure browser context.");
      return;
    }

    this.setStatus("requesting");

    try {
      this.stream = await this.getUserMedia(LIVE_LISTEN_AUDIO_CONSTRAINTS);
    } catch (error) {
      const failure = classifyGetUserMediaError(error);
      this.setFailure(failure.status, failure.message);
      return;
    }

    if (this.disposed) {
      stopMediaStream(this.stream);
      this.stream = null;
      return;
    }

    this.audioContext = this.createContext();
    if (!this.audioContext || !this.stream) {
      stopMediaStream(this.stream);
      this.stream = null;
      this.setFailure("unsupported", "Web Audio API is not available in this browser.");
      return;
    }

    try {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.7;
      // Intentionally not connected to destination — Live Listen must not play the mic.
      this.sourceNode.connect(this.analyser);
      this.frequencyBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.timeBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    } catch {
      await this.tearDownGraph();
      this.setFailure("error", "Could not start Live Listen. Try again or use Demo Track.");
      return;
    }

    this.setStatus("listening");
    this.startLoop();
  }

  async pause(): Promise<void> {
    if (this.status !== "listening") return;
    this.stopLoop();
    this.setStatus("paused");
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.tearDownGraph();
    this.listeners.clear();
    this.status = "idle";
    this.errorMessage = undefined;
    this.frame = silentFrame(this.now(), this.bandCount);
  }

  private async tearDownGraph(): Promise<void> {
    this.stopLoop();
    stopMediaStream(this.stream);
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

    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        // ignore close races
      }
      this.audioContext = null;
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
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
      this.emit();
    };
    this.rafId = this.raf(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      this.caf(this.rafId);
      this.rafId = null;
    }
  }

  private setStatus(status: LiveListenEngineStatus): void {
    this.status = status;
    if (status === "listening") {
      this.errorMessage = undefined;
    }
    if (status !== "listening") {
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

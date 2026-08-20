import { audioFeatureFrameSchema, type AudioFeatureFrame, type AudioMode } from "@prism/contracts";

import { createAudioContext } from "./audio-context.js";
import { DEFAULT_BAND_COUNT, DEFAULT_FFT_SIZE, FEATURE_INTERVAL_MS } from "./constants.js";
import {
  buildFeatureFrame,
  createFeatureExtractorState,
  silentFrame,
  type FeatureExtractorState,
} from "./feature-math.js";
import { acquireResource } from "./runtime-resources.js";

export type DemoTrackEngineStatus =
  "idle" | "loading" | "ready" | "needs_gesture" | "playing" | "paused" | "unsupported" | "error";

export type DemoTrackEngineOptions = {
  trackUrl: string;
  fftSize?: number;
  bandCount?: number;
  loop?: boolean;
  /** Validate emitted frames with Zod (tests / debug). Default false for hot path. */
  validateFrames?: boolean;
};

export type DemoTrackEngineListener = (event: {
  status: DemoTrackEngineStatus;
  frame: AudioFeatureFrame;
  errorMessage?: string;
}) => void;

/**
 * Framework-independent Demo Track playback + local feature extraction.
 * Never persists or transmits PCM — numeric frames only.
 */
export class DemoTrackEngine {
  readonly mode: AudioMode = "demo_track";

  private readonly trackUrl: string;
  private readonly fftSize: number;
  private readonly bandCount: number;
  private readonly loop: boolean;
  private readonly validateFrames: boolean;
  private readonly listeners = new Set<DemoTrackEngineListener>();

  private status: DemoTrackEngineStatus = "idle";
  private errorMessage: string | undefined;
  private frame: AudioFeatureFrame;
  private extractor: FeatureExtractorState;

  private audioContext: AudioContext | null = null;
  private mediaElement: HTMLAudioElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frequencyBuffer: Uint8Array<ArrayBuffer> | null = null;
  private timeBuffer: Uint8Array<ArrayBuffer> | null = null;
  private rafId: number | null = null;
  private lastEmitMs = 0;
  private disposed = false;
  private visibilityHandler: (() => void) | null = null;
  private mediaErrorHandler: (() => void) | null = null;
  private mediaCanPlayHandler: (() => void) | null = null;
  private releaseContext: (() => void) | null = null;
  private releaseSource: (() => void) | null = null;
  private releaseLoop: (() => void) | null = null;

  constructor(options: DemoTrackEngineOptions) {
    this.trackUrl = options.trackUrl;
    this.fftSize = options.fftSize ?? DEFAULT_FFT_SIZE;
    this.bandCount = options.bandCount ?? DEFAULT_BAND_COUNT;
    this.loop = options.loop ?? true;
    this.validateFrames = options.validateFrames ?? false;
    this.frame = silentFrame(0, this.bandCount);
    this.extractor = createFeatureExtractorState(this.bandCount);
  }

  getStatus(): DemoTrackEngineStatus {
    return this.status;
  }

  getFrame(): AudioFeatureFrame {
    return this.frame;
  }

  getErrorMessage(): string | undefined {
    return this.errorMessage;
  }

  /** Current Demo Track position in milliseconds (0 when media is unavailable). */
  getPositionMs(): number {
    return (this.mediaElement?.currentTime ?? 0) * 1000;
  }

  setPositionMs(positionMs: number): void {
    if (!this.mediaElement) return;
    const duration = this.mediaElement.duration;
    const seconds = Math.max(0, positionMs / 1000);
    this.mediaElement.currentTime =
      Number.isFinite(duration) && duration > 0
        ? Math.min(seconds, Math.max(0, duration - 0.05))
        : seconds;
  }

  getPlaybackRate(): number {
    return this.mediaElement?.playbackRate ?? 1;
  }

  setPlaybackRate(rate: number): void {
    if (!this.mediaElement) return;
    this.mediaElement.playbackRate = Math.min(2, Math.max(0.5, rate));
  }

  subscribe(listener: DemoTrackEngineListener): () => void {
    this.listeners.add(listener);
    listener({ status: this.status, frame: this.frame, errorMessage: this.errorMessage });
    return () => {
      this.listeners.delete(listener);
    };
  }

  async prepare(): Promise<void> {
    if (this.disposed) return;
    if (this.status === "ready" || this.status === "playing" || this.status === "paused") return;

    this.setStatus("loading");

    if (typeof window === "undefined" || typeof document === "undefined") {
      this.fail("Audio engine requires a browser environment.");
      return;
    }

    this.audioContext = createAudioContext();
    if (!this.audioContext) {
      this.setStatus("unsupported");
      this.errorMessage = "Web Audio API is not available in this browser.";
      this.emit();
      return;
    }

    const media = new Audio();
    media.preload = "auto";
    media.crossOrigin = "anonymous";
    media.loop = this.loop;
    media.src = this.trackUrl;
    this.mediaElement = media;

    this.mediaErrorHandler = () => {
      this.fail("Demo Track failed to load or decode.");
    };
    this.mediaCanPlayHandler = () => {
      if (this.status === "loading") {
        this.setStatus(this.audioContext?.state === "running" ? "ready" : "needs_gesture");
      }
    };
    media.addEventListener("error", this.mediaErrorHandler);
    media.addEventListener("canplaythrough", this.mediaCanPlayHandler);

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("media error"));
      };
      const cleanup = () => {
        media.removeEventListener("canplaythrough", onReady);
        media.removeEventListener("error", onError);
      };
      if (media.readyState >= 3) {
        resolve();
        return;
      }
      media.addEventListener("canplaythrough", onReady, { once: true });
      media.addEventListener("error", onError, { once: true });
      media.load();
    }).catch(() => {
      this.fail("Demo Track failed to load or decode.");
    });

    if (this.disposed || this.status === "error" || this.status === "unsupported") return;

    this.sourceNode = this.audioContext.createMediaElementSource(media);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.7;
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
    this.releaseContext = acquireResource("audioContexts");
    this.releaseSource = acquireResource("mediaSources");

    this.frequencyBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.timeBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));

    this.visibilityHandler = () => {
      if (document.visibilityState === "hidden" && this.status === "playing") {
        void this.pause();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);

    this.setStatus(this.audioContext.state === "running" ? "ready" : "needs_gesture");
  }

  async play(): Promise<void> {
    if (this.disposed) return;
    if (this.status === "playing") return;
    if (!this.audioContext || !this.mediaElement) {
      await this.prepare();
    }
    if (this.disposed || !this.audioContext || !this.mediaElement) return;
    if (this.status === "error" || this.status === "unsupported") return;

    try {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      await this.mediaElement.play();
      this.setStatus("playing");
      this.startLoop();
    } catch {
      this.setStatus("needs_gesture");
      this.errorMessage = "Playback blocked until you press Play.";
      this.emit();
    }
  }

  async pause(): Promise<void> {
    if (!this.mediaElement) return;
    this.mediaElement.pause();
    this.stopLoop();
    if (this.status === "playing") {
      this.setStatus("paused");
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();

    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }

    if (this.mediaElement) {
      if (this.mediaErrorHandler) {
        this.mediaElement.removeEventListener("error", this.mediaErrorHandler);
      }
      if (this.mediaCanPlayHandler) {
        this.mediaElement.removeEventListener("canplaythrough", this.mediaCanPlayHandler);
      }
      this.mediaElement.pause();
      this.mediaElement.removeAttribute("src");
      this.mediaElement.load();
      this.mediaElement = null;
    }

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

    this.listeners.clear();
    this.status = "idle";
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    this.releaseLoop = acquireResource("animationLoops");
    const tick = (now: number) => {
      this.rafId = window.requestAnimationFrame(tick);
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
    this.rafId = window.requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.releaseLoop?.();
    this.releaseLoop = null;
  }

  private setStatus(status: DemoTrackEngineStatus): void {
    this.status = status;
    if (status !== "error" && status !== "needs_gesture") {
      this.errorMessage = undefined;
    }
    if (status !== "playing") {
      this.frame = silentFrame(
        typeof performance !== "undefined" ? performance.now() : 0,
        this.bandCount,
      );
    }
    this.emit();
  }

  private fail(message: string): void {
    this.status = "error";
    this.errorMessage = message;
    this.stopLoop();
    this.frame = silentFrame(
      typeof performance !== "undefined" ? performance.now() : 0,
      this.bandCount,
    );
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

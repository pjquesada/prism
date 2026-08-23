import { describe, expect, it, vi } from "vitest";

import { BrowserCaptureEngine } from "./browser-capture-engine.js";
import {
  BROWSER_CAPTURE_CONSTRAINTS,
  NO_AUDIO_SHARED_MESSAGE,
  buildBrowserCaptureConstraints,
  canRequestBrowserCapture,
  classifyGetDisplayMediaError,
  discardCapturedVideoTracks,
  streamHasAudioTrack,
} from "./display-media.js";

type FakeTrack = {
  kind: string;
  readyState: MediaStreamTrackState;
  stop: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function createFakeTrack(kind: "audio" | "video"): FakeTrack {
  return {
    kind,
    readyState: "live",
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function createFakeStream(kinds: Array<"audio" | "video"> = ["audio", "video"]): {
  stream: MediaStream;
  tracks: FakeTrack[];
} {
  const tracks = kinds.map((kind) => createFakeTrack(kind));
  const stream = {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  } as unknown as MediaStream;
  return { stream, tracks };
}

function createFakeContext() {
  const analyser = {
    fftSize: 2048,
    frequencyBinCount: 1024,
    smoothingTimeConstant: 0.7,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getByteFrequencyData: (buffer: Uint8Array) => {
      buffer.fill(12);
    },
    getByteTimeDomainData: (buffer: Uint8Array) => {
      buffer.fill(128);
    },
  };
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return {
    state: "running" as AudioContextState,
    sampleRate: 44100,
    destination: {},
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    source,
    analyser,
  };
}

describe("display-media helpers", () => {
  it("requests audio in capture constraints and never requires rendered video", () => {
    expect(BROWSER_CAPTURE_CONSTRAINTS.audio).toBeTruthy();
    const built = buildBrowserCaptureConstraints();
    expect(built.audio).toBeTruthy();
    expect(built.video).toBeTruthy();
  });

  it("feature-detects getDisplayMedia support", () => {
    expect(
      canRequestBrowserCapture(
        { getDisplayMedia: async () => createFakeStream().stream },
        true,
      ),
    ).toBe(true);
    expect(canRequestBrowserCapture({ getDisplayMedia: async () => createFakeStream().stream }, false)).toBe(
      false,
    );
    expect(canRequestBrowserCapture(null, true)).toBe(false);
  });

  it("maps denial and missing audio messages without leaking error names", () => {
    const denied = classifyGetDisplayMediaError(
      Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }),
    );
    expect(denied.status).toBe("denied");
    expect(denied.message).not.toMatch(/NotAllowedError/);
    expect(NO_AUDIO_SHARED_MESSAGE).toMatch(/Share tab audio|Share system audio/i);
  });

  it("discards video tracks without touching audio", () => {
    const { stream, tracks } = createFakeStream(["audio", "video"]);
    discardCapturedVideoTracks(stream);
    expect(tracks.find((t) => t.kind === "video")?.stop).toHaveBeenCalled();
    expect(tracks.find((t) => t.kind === "audio")?.stop).not.toHaveBeenCalled();
    expect(streamHasAudioTrack(stream)).toBe(true);
  });
});

describe("BrowserCaptureEngine", () => {
  it("starts only after start() and never connects capture audio to speakers", async () => {
    const { stream, tracks } = createFakeStream();
    const context = createFakeContext();
    const getDisplayMedia = vi.fn(async () => stream);
    const engine = new BrowserCaptureEngine({
      getDisplayMedia,
      createContext: () => context as unknown as AudioContext,
      isSecureContext: () => true,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
      now: () => 16,
    });

    expect(getDisplayMedia).not.toHaveBeenCalled();
    await engine.start();
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    const constraints = getDisplayMedia.mock.calls[0]?.[0] as DisplayMediaStreamOptions;
    expect(constraints.audio).toBeTruthy();
    expect(context.source.connect).toHaveBeenCalledWith(context.analyser);
    expect(context.analyser.connect).not.toHaveBeenCalled();
    expect(tracks.find((t) => t.kind === "video")?.stop).toHaveBeenCalled();
    expect(JSON.stringify(engine.getFrame())).not.toMatch(/pcm|MediaStream|fft|video/);
    await engine.dispose();
    expect(tracks.find((t) => t.kind === "audio")?.stop).toHaveBeenCalled();
  });

  it("rejects a shared stream with no audio track", async () => {
    const { stream } = createFakeStream(["video"]);
    const engine = new BrowserCaptureEngine({
      getDisplayMedia: async () => stream,
      createContext: () => createFakeContext() as unknown as AudioContext,
      isSecureContext: () => true,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
    });
    await engine.start();
    expect(engine.getStatus()).toBe("no_audio");
    expect(engine.getErrorMessage()).toBe(NO_AUDIO_SHARED_MESSAGE);
    await engine.dispose();
  });

  it("emits changing feature envelopes from captured audio analyser data", async () => {
    const { stream } = createFakeStream();
    const context = createFakeContext();
    let frameCallback: FrameRequestCallback | null = null;
    const engine = new BrowserCaptureEngine({
      getDisplayMedia: async () => stream,
      createContext: () => context as unknown as AudioContext,
      isSecureContext: () => true,
      requestAnimationFrame: (callback) => {
        frameCallback = callback;
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
      now: () => 0,
    });
    await engine.start();
    expect(engine.getStatus()).toBe("waiting");
    context.analyser.getByteFrequencyData = (buffer: Uint8Array) => {
      buffer.fill(200);
    };
    context.analyser.getByteTimeDomainData = (buffer: Uint8Array) => {
      for (let i = 0; i < buffer.length; i += 1) buffer[i] = i % 2 === 0 ? 255 : 0;
    };
    frameCallback?.(80);
    expect(engine.getFrame().energy).toBeGreaterThan(0);
    expect(engine.getStatus()).toBe("listening");
    expect(JSON.stringify(engine.getFrame())).not.toMatch(/pcm|fft|MediaStream|video/);
    await engine.dispose();
  });

  it("stops analysis when the shared audio track ends", async () => {
    const { stream, tracks } = createFakeStream();
    const context = createFakeContext();
    const engine = new BrowserCaptureEngine({
      getDisplayMedia: async () => stream,
      createContext: () => context as unknown as AudioContext,
      isSecureContext: () => true,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
    });
    await engine.start();
    const audio = tracks.find((t) => t.kind === "audio")!;
    const ended = audio.addEventListener.mock.calls.find((call) => call[0] === "ended")?.[1] as
      | (() => void)
      | undefined;
    expect(ended).toBeTypeOf("function");
    audio.readyState = "ended";
    ended?.();
    await vi.waitFor(() => {
      expect(engine.getStatus()).toBe("ended");
    });
    expect(engine.getErrorMessage()).toMatch(/Sharing stopped/i);
    await engine.dispose();
  });

  it("disposes all capture resources when stop() runs", async () => {
    const { stream, tracks } = createFakeStream();
    const context = createFakeContext();
    const engine = new BrowserCaptureEngine({
      getDisplayMedia: async () => stream,
      createContext: () => context as unknown as AudioContext,
      isSecureContext: () => true,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
    });
    await engine.start();
    await engine.stop();
    expect(engine.getStatus()).toBe("ended");
    expect(tracks.every((t) => t.stop.mock.calls.length > 0)).toBe(true);
    expect(context.close).toHaveBeenCalled();
    await engine.dispose();
  });

  it("does not call getDisplayMedia until start() after a user gesture", async () => {
    const getDisplayMedia = vi.fn(async () => createFakeStream().stream);
    const engine = new BrowserCaptureEngine({
      getDisplayMedia,
      createContext: () => createFakeContext() as unknown as AudioContext,
      isSecureContext: () => true,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
    });
    expect(getDisplayMedia).not.toHaveBeenCalled();
    await engine.start();
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    await engine.dispose();
  });
});

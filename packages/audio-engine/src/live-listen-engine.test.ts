import { describe, expect, it, vi } from "vitest";

import { LiveListenEngine } from "./live-listen-engine.js";
import { LIVE_LISTEN_AUDIO_CONSTRAINTS } from "./media-permission.js";

type FakeTrack = { kind: string; stop: ReturnType<typeof vi.fn> };

function createFakeStream(): { stream: MediaStream; tracks: FakeTrack[] } {
  const tracks: FakeTrack[] = [{ kind: "audio", stop: vi.fn() }];
  const stream = {
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
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

describe("LiveListenEngine", () => {
  it("starts analysis without connecting the microphone to speakers", async () => {
    const { stream, tracks } = createFakeStream();
    const context = createFakeContext();
    const getUserMedia = vi.fn(async () => stream);
    const engine = new LiveListenEngine({
      getUserMedia,
      createContext: () => context as unknown as AudioContext,
      isSecureContext: () => true,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
      now: () => 16,
    });

    await engine.start();
    expect(engine.getStatus()).toBe("listening");
    expect(getUserMedia).toHaveBeenCalledWith(LIVE_LISTEN_AUDIO_CONSTRAINTS);
    expect(context.source.connect).toHaveBeenCalledWith(context.analyser);
    expect(context.analyser.connect).not.toHaveBeenCalled();
    expect(JSON.stringify(engine.getFrame())).not.toMatch(/pcm|microphone|MediaStream/);

    await engine.dispose();
    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(engine.getStatus()).toBe("idle");
  });

  it("emits numeric feature frames from mocked microphone analyser data", async () => {
    const { stream } = createFakeStream();
    const context = createFakeContext();
    let frameCallback: FrameRequestCallback | null = null;
    const engine = new LiveListenEngine({
      getUserMedia: async () => stream,
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
    expect(engine.getFrame().energy).toBe(0);
    context.analyser.getByteFrequencyData = (buffer: Uint8Array) => {
      buffer.fill(180);
    };
    context.analyser.getByteTimeDomainData = (buffer: Uint8Array) => {
      for (let i = 0; i < buffer.length; i += 1) buffer[i] = i % 2 === 0 ? 255 : 0;
    };
    frameCallback?.(80);
    expect(engine.getFrame().energy).toBeGreaterThan(0);
    expect(JSON.stringify(engine.getFrame())).not.toMatch(/pcm|fft|MediaStream/);
    await engine.dispose();
  });

  it("surfaces a denied permission without storing a stream", async () => {
    const engine = new LiveListenEngine({
      getUserMedia: async () => {
        throw Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
      },
      createContext: () => null,
      isSecureContext: () => true,
    });
    await engine.start();
    expect(engine.getStatus()).toBe("denied");
    expect(engine.getErrorMessage()).toMatch(/permission was denied/i);
    expect(engine.getFrame().energy).toBe(0);
    await engine.dispose();
  });

  it("resumes a suspended AudioContext after the user gesture", async () => {
    const { stream, tracks } = createFakeStream();
    const context = createFakeContext();
    context.state = "suspended";
    context.resume = vi.fn(async () => {
      context.state = "running";
    });
    const getUserMedia = vi.fn(async () => stream);
    const engine = new LiveListenEngine({
      getUserMedia,
      createContext: () => context as unknown as AudioContext,
      isSecureContext: () => true,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
      now: () => 16,
    });
    await engine.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalled();
    expect(engine.getStatus()).toBe("listening");
    await engine.dispose();
    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it("surfaces inactive when AudioContext cannot run", async () => {
    const { stream } = createFakeStream();
    const context = createFakeContext();
    context.state = "suspended";
    context.resume = vi.fn(async () => {
      context.state = "suspended";
    });
    const engine = new LiveListenEngine({
      getUserMedia: async () => stream,
      createContext: () => context as unknown as AudioContext,
      isSecureContext: () => true,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
    });
    await engine.start();
    expect(engine.getStatus()).toBe("inactive");
    await engine.dispose();
  });

  it("invokes getUserMedia before awaiting graph teardown", async () => {
    const order: string[] = [];
    const { stream } = createFakeStream();
    const context = createFakeContext();
    const engine = new LiveListenEngine({
      getUserMedia: async () => {
        order.push("gum");
        return stream;
      },
      createContext: () => {
        order.push("context");
        return context as unknown as AudioContext;
      },
      isSecureContext: () => true,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
    });
    await engine.start();
    expect(order[0]).toBe("gum");
    expect(order).toContain("context");
    await engine.dispose();
  });

  it("pauses analysis and resumes without a second getUserMedia call", async () => {
    const { stream } = createFakeStream();
    const context = createFakeContext();
    const getUserMedia = vi.fn(async () => stream);
    const engine = new LiveListenEngine({
      getUserMedia,
      createContext: () => context as unknown as AudioContext,
      isSecureContext: () => true,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
    });
    await engine.start();
    await engine.pause();
    expect(engine.getStatus()).toBe("paused");
    await engine.start();
    expect(engine.getStatus()).toBe("listening");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await engine.dispose();
  });
});

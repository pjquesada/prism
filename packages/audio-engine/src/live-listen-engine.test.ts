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

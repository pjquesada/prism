import { describe, expect, it, vi } from "vitest";

import {
  MediaStreamAnalysisGraph,
  SILENT_OUTPUT_GAIN,
  describeAudioTrack,
  isLiveAudioTrack,
  runMediaStreamInputSelfTest,
} from "./media-stream-analysis.js";

type FakeTrack = {
  kind: string;
  enabled: boolean;
  muted: boolean;
  readyState: MediaStreamTrackState;
  stop: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  getSettings: ReturnType<typeof vi.fn>;
  getConstraints: ReturnType<typeof vi.fn>;
  getCapabilities: ReturnType<typeof vi.fn>;
};

function createFakeTrack(overrides: Partial<FakeTrack> = {}): FakeTrack {
  return {
    kind: "audio",
    enabled: true,
    muted: false,
    readyState: "live",
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getSettings: vi.fn(() => ({ sampleRate: 48_000 })),
    getConstraints: vi.fn(() => ({ echoCancellation: false })),
    getCapabilities: vi.fn(() => ({ channelCount: { max: 2 } })),
    ...overrides,
  };
}

function createFakeStream(track = createFakeTrack()): MediaStream {
  const tracks = [track];
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

function createFakeContext() {
  const silentGain = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const analyser = {
    fftSize: 2048,
    frequencyBinCount: 1024,
    smoothingTimeConstant: 0.35,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getByteFrequencyData: (buffer: Uint8Array) => {
      buffer.fill(0);
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
    sampleRate: 44_100,
    destination: {},
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
    createGain: vi.fn(() => silentGain),
    createMediaStreamDestination: vi.fn(() => ({
      stream: createFakeStream(),
    })),
    createOscillator: vi.fn(() => ({
      type: "sine",
      frequency: { value: 440 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    source,
    analyser,
    silentGain,
  };
}

describe("MediaStreamAnalysisGraph", () => {
  it("routes source through analyser and zero-gain tap to destination", async () => {
    const context = createFakeContext();
    const graph = new MediaStreamAnalysisGraph();
    const gen = graph.beginGeneration();
    await graph.connect(createFakeStream(), context as unknown as AudioContext, gen);
    expect(context.createGain).toHaveBeenCalled();
    expect(context.silentGain.gain.value).toBe(SILENT_OUTPUT_GAIN);
    expect(context.source.connect).toHaveBeenCalledWith(context.analyser);
    expect(context.analyser.connect).toHaveBeenCalledWith(context.silentGain);
    expect(context.silentGain.connect).toHaveBeenCalledWith(context.destination);
    await graph.dispose(gen);
  });

  it("produces non-zero features from deterministic non-silent analyser samples", async () => {
    const context = createFakeContext();
    let frameCallback: FrameRequestCallback | null = null;
    const graph = new MediaStreamAnalysisGraph({
      requestAnimationFrame: (callback) => {
        frameCallback = callback;
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
      now: () => 80,
    });
    const gen = graph.beginGeneration();
    await graph.connect(createFakeStream(), context as unknown as AudioContext, gen);
    graph.startLoop(gen);
    context.analyser.getByteFrequencyData = (buffer: Uint8Array) => {
      buffer.fill(210);
    };
    context.analyser.getByteTimeDomainData = (buffer: Uint8Array) => {
      for (let i = 0; i < buffer.length; i += 1) buffer[i] = i % 2 === 0 ? 255 : 0;
    };
    frameCallback?.(80);
    expect(graph.getFrame().energy).toBeGreaterThan(0);
    expect(graph.getFrame().rms).toBeGreaterThan(0);
    await graph.dispose(gen);
  });

  it("keeps silent input silent", async () => {
    const context = createFakeContext();
    let frameCallback: FrameRequestCallback | null = null;
    const graph = new MediaStreamAnalysisGraph({
      requestAnimationFrame: (callback) => {
        frameCallback = callback;
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
      now: () => 80,
    });
    const gen = graph.beginGeneration();
    await graph.connect(createFakeStream(), context as unknown as AudioContext, gen);
    graph.startLoop(gen);
    frameCallback?.(80);
    expect(graph.getFrame().energy).toBe(0);
    expect(graph.getFrame().rms).toBe(0);
    await graph.dispose(gen);
  });

  it("prevents stale teardown from stopping a newer capture generation", async () => {
    const context = createFakeContext();
    const graph = new MediaStreamAnalysisGraph({
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn(),
    });
    const first = graph.beginGeneration();
    await graph.connect(createFakeStream(), context as unknown as AudioContext, first);
    graph.startLoop(first);
    const second = graph.beginGeneration();
    await graph.connect(createFakeStream(), context as unknown as AudioContext, second);
    graph.startLoop(second);
    await graph.dispose(first);
    expect(graph.getStream()).not.toBeNull();
    expect(graph.isLoopActive()).toBe(true);
    await graph.dispose(second);
  });

  it("describes audio track state without device labels or stream ids", () => {
    const track = createFakeTrack({ muted: true });
    const summary = describeAudioTrack(createFakeStream(track));
    expect(summary.present).toBe(true);
    expect(summary.muted).toBe(true);
    expect(summary.readyState).toBe("live");
    expect(JSON.stringify(summary)).not.toMatch(/label|deviceId|MediaStream|stream/i);
  });

  it("treats muted tracks as not live for detection", () => {
    expect(isLiveAudioTrack(createFakeStream(createFakeTrack({ muted: true })))).toBe(false);
    expect(isLiveAudioTrack(createFakeStream(createFakeTrack({ readyState: "ended" })))).toBe(
      false,
    );
    expect(isLiveAudioTrack(createFakeStream())).toBe(true);
  });
});

describe("runMediaStreamInputSelfTest", () => {
  it("reports stage results using the shared analyser graph", async () => {
    const context = createFakeContext();
    context.analyser.getByteFrequencyData = (buffer: Uint8Array) => buffer.fill(220);
    context.analyser.getByteTimeDomainData = (buffer: Uint8Array) => {
      for (let i = 0; i < buffer.length; i += 1) buffer[i] = i % 2 === 0 ? 250 : 5;
    };
    const result = await runMediaStreamInputSelfTest({
      createContext: () => context as unknown as AudioContext,
      requestAnimationFrame: (callback) => {
        setTimeout(() => callback(80), 0);
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
      now: () => 80,
      publish: () => true,
      observeDisplay: () => 2,
    });
    expect(result.ok).toBe(true);
    expect(result.peakRms).toBeGreaterThan(0);
    expect(result.stages.find((stage) => stage.stage === "analyserSamples")?.status).toBe("pass");
  });
});

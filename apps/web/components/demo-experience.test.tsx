import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioFeatureFrame } from "@prism/contracts";
import { createSilentFeatureFrame } from "@prism/contracts";

const listeners = new Set<(event: unknown) => void>();

const engineMock = {
  prepare: vi.fn(async () => {
    for (const listener of listeners) {
      listener({
        status: "ready",
        frame: createSilentFeatureFrame(),
        errorMessage: undefined,
      });
    }
  }),
  play: vi.fn(async () => {
    for (const listener of listeners) {
      listener({
        status: "playing",
        frame: {
          ...createSilentFeatureFrame(),
          energy: 0.4,
          onset: true,
        } satisfies AudioFeatureFrame,
      });
    }
  }),
  pause: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
  subscribe: vi.fn((listener: (event: unknown) => void) => {
    listeners.add(listener);
    listener({ status: "idle", frame: createSilentFeatureFrame() });
    return () => listeners.delete(listener);
  }),
};

const browserEngineMock = {
  start: vi.fn(async () => {
    for (const listener of listeners) {
      listener({
        status: "waiting",
        frame: createSilentFeatureFrame(),
        errorMessage: undefined,
      });
    }
  }),
  pause: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
  getStatus: vi.fn(() => "idle"),
  subscribe: vi.fn((listener: (event: unknown) => void) => {
    listeners.add(listener);
    listener({ status: "idle", frame: createSilentFeatureFrame() });
    return () => listeners.delete(listener);
  }),
};

const liveEngineMock = {
  start: vi.fn(async () => {
    for (const listener of listeners) {
      listener({
        status: "listening",
        frame: createSilentFeatureFrame(),
        errorMessage: undefined,
      });
    }
  }),
  pause: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
  getStatus: vi.fn(() => "idle"),
  subscribe: vi.fn((listener: (event: unknown) => void) => {
    listeners.add(listener);
    listener({ status: "idle", frame: createSilentFeatureFrame() });
    return () => listeners.delete(listener);
  }),
};

vi.mock("@prism/audio-engine", () => ({
  DemoTrackEngine: vi.fn(function DemoTrackEngine() {
    return engineMock;
  }),
  BrowserCaptureEngine: vi.fn(function BrowserCaptureEngine() {
    return browserEngineMock;
  }),
  LiveListenEngine: vi.fn(function LiveListenEngine() {
    return liveEngineMock;
  }),
  silentFrame: (timestampMs = 0, bandCount = 32) =>
    createSilentFeatureFrame(timestampMs, bandCount),
  LIVE_LISTEN_SOUND_THRESHOLD: 0.035,
  BROWSER_CAPTURE_SOUND_THRESHOLD: 0.035,
  detectDisplayMediaSupport: () => ({
    secureContext: true,
    getDisplayMedia: true,
    canAttemptAudioCapture: true,
  }),
  getResourceCounts: () => ({
    audioContexts: 0,
    mediaSources: 0,
    animationLoops: 0,
    realtimeSubscriptions: 0,
  }),
}));

vi.mock("@prism/visual-engine", () => ({
  VisualizerCanvas: ({ plugin }: { plugin: { id: string } }) => (
    <div data-visualizer={plugin.id}>visualizer-canvas</div>
  ),
  registerPerfResourceSource: vi.fn(),
}));

vi.mock("@prism/visualizers", () => ({
  requireVisualizerPlugin: (id: string) => ({
    id,
    label: id === "particles" ? "Particles" : id === "album_world" ? "Album World" : "Spectrum",
    defaultParams: { sensitivity: 1 },
  }),
  listVisualizerPlugins: () => [
    { id: "spectrum", label: "Spectrum", description: "Spectrum bars" },
    { id: "particles", label: "Particles", description: "Particle field" },
    { id: "album_world", label: "Album World", description: "Album art world" },
  ],
}));

import { DemoExperience } from "@/components/demo-experience";

describe("DemoExperience", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("shows play control and starts playback on click", async () => {
    render(<DemoExperience variant="demo" />);
    expect(engineMock.prepare).toHaveBeenCalled();
    const play = await screen.findByRole("button", { name: /^play$/i });
    fireEvent.click(play);
    expect(engineMock.play).toHaveBeenCalled();
  });

  it("switches visualizers without remounting audio engine", async () => {
    render(<DemoExperience variant="demo" />);
    expect(engineMock.prepare).toHaveBeenCalledTimes(1);
    const group = screen.getByRole("group", { name: /visualizer/i });
    const particles = within(group).getByRole("button", { name: /^particles$/i });
    fireEvent.click(particles);
    expect(screen.getByRole("heading", { name: /^particles$/i })).toBeTruthy();
    expect(document.querySelectorAll("[data-visualizer]")).toHaveLength(1);
    expect(engineMock.prepare).toHaveBeenCalledTimes(1);
  });

  it("starts Capture Music via browser capture and disposes Demo Track", async () => {
    render(<DemoExperience variant="demo" />);
    expect(browserEngineMock.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("audio-mode-browser_capture"));
    expect(engineMock.dispose).toHaveBeenCalled();
    expect(browserEngineMock.start).toHaveBeenCalled();
    expect(screen.getByTestId("audio-mode-browser_capture").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("capture-music-privacy").textContent).toMatch(
      /Audio analysis stays on this device/i,
    );
  });

  it("keeps microphone fallback working", async () => {
    render(<DemoExperience variant="demo" />);
    fireEvent.click(screen.getByTestId("audio-mode-microphone"));
    expect(liveEngineMock.start).toHaveBeenCalled();
    expect(screen.getByTestId("audio-mode-microphone").getAttribute("aria-pressed")).toBe("true");
  });
});

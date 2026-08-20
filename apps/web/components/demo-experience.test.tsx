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
  LiveListenEngine: vi.fn(function LiveListenEngine() {
    return liveEngineMock;
  }),
  silentFrame: (timestampMs = 0, bandCount = 32) =>
    createSilentFeatureFrame(timestampMs, bandCount),
}));

vi.mock("@prism/visual-engine", () => ({
  VisualizerCanvas: ({ plugin }: { plugin: { id: string } }) => (
    <div data-visualizer={plugin.id}>visualizer-canvas</div>
  ),
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

  it("starts Live Listen locally and does not keep the Demo Track engine", async () => {
    render(<DemoExperience variant="demo" />);
    expect(liveEngineMock.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("audio-mode-live_listen"));
    expect(engineMock.dispose).toHaveBeenCalled();
    expect(liveEngineMock.start).toHaveBeenCalled();
    expect(screen.getByTestId("audio-mode-live_listen").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("live-listen-privacy").textContent).toMatch(
      /Microphone audio stays on this device/i,
    );
  });
});

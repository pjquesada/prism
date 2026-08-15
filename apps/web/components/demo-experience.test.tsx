import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@prism/audio-engine", () => ({
  DemoTrackEngine: vi.fn(function DemoTrackEngine() {
    return engineMock;
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
}));

import { DemoExperience } from "@/components/demo-experience";

describe("DemoExperience", () => {
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
    const particles = await screen.findByRole("button", { name: /^particles$/i });
    fireEvent.click(particles);
    expect(screen.getByRole("heading", { name: /particles/i })).toBeTruthy();
    expect(document.querySelectorAll("[data-visualizer]")).toHaveLength(1);
    expect(engineMock.prepare).toHaveBeenCalledTimes(1);
  });
});

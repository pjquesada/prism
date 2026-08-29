import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySessionMessage,
  createSyncEngineState,
  setConnectionStatus,
  setLocalIdentity,
  type SyncEngineState,
} from "@prism/sync-engine";
import {
  AUDIO_FEATURE_ENVELOPE_MAX_HZ,
  createSilentFeatureEnvelope,
  createSilentFeatureFrame,
  type AudioFeatureEnvelope,
  type SessionSnapshot,
} from "@prism/contracts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const { DemoTrackEngine, demoEngineMock, demoListeners, captureEngineMock, captureListeners } =
  vi.hoisted(() => {
    const silent = {
      timestampMs: 0,
      rms: 0,
      peak: 0,
      bpmEstimate: null,
      beatPhase: 0,
      bands: Array.from({ length: 32 }, () => 0),
      energy: 0,
      onset: false,
      bass: 0,
      mid: 0,
      high: 0,
    };
    const demoListeners = new Set<(event: unknown) => void>();
    const captureListeners = new Set<(event: unknown) => void>();
    const demoEngineMock = {
      prepare: vi.fn(async () => undefined),
      play: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      getStatus: vi.fn(() => "ready"),
      getPositionMs: vi.fn(() => 0),
      getPlaybackRate: vi.fn(() => 1),
      subscribe: vi.fn((listener: (event: unknown) => void) => {
        demoListeners.add(listener);
        listener({ status: "ready", frame: silent });
        return () => demoListeners.delete(listener);
      }),
    };
    const captureEngineMock = {
      start: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      getStatus: vi.fn(() => "listening"),
      subscribe: vi.fn((listener: (event: unknown) => void) => {
        captureListeners.add(listener);
        listener({ status: "listening", frame: { ...silent, energy: 0.2, rms: 0.2 } });
        return () => captureListeners.delete(listener);
      }),
    };
    const DemoTrackEngine = vi.fn(function DemoTrackEngine() {
      return demoEngineMock;
    });
    return {
      DemoTrackEngine,
      demoEngineMock,
      demoListeners,
      captureEngineMock,
      captureListeners,
    };
  });

vi.mock("@prism/audio-engine", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DemoTrackEngine,
  };
});

vi.mock("@prism/visual-engine", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    VisualizerCanvas: ({
      resolveFeatures,
    }: {
      resolveFeatures?: (nowMs: number) => { energy: number };
    }) => (
      <div data-testid="visualizer-host" data-has-resolver={resolveFeatures ? "true" : "false"}>
        canvas
      </div>
    ),
  };
});

vi.mock("@prism/visualizers", () => ({
  requireVisualizerPlugin: (id: string) => ({
    id,
    label: id === "particles" ? "Particles" : id === "album_world" ? "Album World" : "Spectrum",
    defaultParams: { sensitivity: 1 },
  }),
}));

import {
  getResourceCounts as realGetResourceCounts,
  resetResourceCountsForTests as realReset,
} from "@prism/audio-engine";
import { SessionVisualizerStage } from "@/components/session/session-visualizer-stage";

function snapshot(audioMode: "demo_track" | "live_listen" = "demo_track"): SessionSnapshot {
  const now = new Date().toISOString();
  return {
    session: {
      id: SESSION_ID,
      hostDeviceId: "controller-1",
      status: "active",
      displayMode: "mirror",
      createdAt: now,
      updatedAt: now,
      expiresAt: now,
      closedAt: null,
      seq: 2,
    },
    devices: [
      {
        id: "row-1",
        sessionId: SESSION_ID,
        deviceId: "controller-1",
        role: "controller",
        label: null,
        displayMode: "mirror",
        lastSeenAt: now,
        isOnline: true,
      },
      {
        id: "row-2",
        sessionId: SESSION_ID,
        deviceId: "display-1",
        role: "display",
        label: null,
        displayMode: "mirror",
        lastSeenAt: now,
        isOnline: true,
      },
    ],
    playback: {
      audioMode,
      isPlaying: true,
      positionMs: 0,
      rate: 1,
      trackId: audioMode === "live_listen" ? "live-listen" : "demo-track",
      updatedAt: now,
      seq: 2,
    },
    preset: {
      visualizerId: "spectrum",
      qualityTier: "high",
      presetId: "builtin-spectrum-calm",
      params: { sensitivity: 1 },
      updatedAt: now,
      seq: 2,
    },
  };
}

function syncFor(
  role: "controller" | "display" | "combined" | null,
  audioMode: "demo_track" | "live_listen" = "demo_track",
): SyncEngineState {
  const deviceId = role === "display" ? "display-1" : "controller-1";
  let state = createSyncEngineState();
  if (role) {
    state = setLocalIdentity(state, { deviceId, role });
  }
  state = applySessionMessage(state, {
    type: "session.snapshot",
    seq: 2,
    sentAt: new Date().toISOString(),
    sessionId: SESSION_ID,
    deviceId,
    payload: snapshot(audioMode),
  }).state;
  return setConnectionStatus(state, "connected");
}

describe("SessionVisualizerStage audio ownership", () => {
  afterEach(() => {
    cleanup();
    demoListeners.clear();
    captureListeners.clear();
    realReset();
  });

  beforeEach(() => {
    DemoTrackEngine.mockClear();
    demoEngineMock.prepare.mockClear();
    demoEngineMock.play.mockClear();
    demoEngineMock.pause.mockClear();
    demoEngineMock.dispose.mockClear();
    demoEngineMock.subscribe.mockClear();
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new Error("getUserMedia should not run in these tests");
        }),
        getDisplayMedia: vi.fn(async () => {
          throw new Error("getDisplayMedia should not run in these tests");
        }),
      },
    });
  });

  it("does not construct Demo Track audio or request capture on a display-only device", () => {
    const gum = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    const gdm = navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>;
    render(
      <SessionVisualizerStage
        sync={syncFor("display")}
        isAudioAuthority={false}
        subscribeFeatures={() => () => undefined}
      />,
    );
    expect(DemoTrackEngine).not.toHaveBeenCalled();
    expect(demoEngineMock.play).not.toHaveBeenCalled();
    expect(gum).not.toHaveBeenCalled();
    expect(gdm).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-visualizer-stage").getAttribute("data-audio-output")).toBe(
      "silent",
    );
    expect(screen.getByTestId("display-silent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /enable audio on this display/i })).toBeNull();
    expect(realGetResourceCounts().audioContexts).toBe(0);
    expect(realGetResourceCounts().mediaSources).toBe(0);
  });

  it("never requests getDisplayMedia or getUserMedia on a display during Capture Music", () => {
    const gum = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    const gdm = navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>;
    render(
      <SessionVisualizerStage
        sync={syncFor("display", "live_listen")}
        isAudioAuthority={false}
        subscribeFeatures={() => () => undefined}
      />,
    );
    expect(DemoTrackEngine).not.toHaveBeenCalled();
    expect(gum).not.toHaveBeenCalled();
    expect(gdm).not.toHaveBeenCalled();
    expect(screen.getByTestId("capture-music-follower")).toBeTruthy();
  });

  it("does not construct audio output while the local role is unresolved", () => {
    render(
      <SessionVisualizerStage
        sync={syncFor(null)}
        isAudioAuthority={false}
        subscribeFeatures={() => () => undefined}
      />,
    );
    expect(DemoTrackEngine).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-visualizer-stage").getAttribute("data-audio-output")).toBe(
      "silent",
    );
    expect(screen.getByTestId("session-visualizer-stage").getAttribute("data-role-resolved")).toBe(
      "false",
    );
  });

  it("creates exactly one Demo Track engine for a controller", () => {
    render(<SessionVisualizerStage sync={syncFor("controller")} isAudioAuthority />);
    expect(DemoTrackEngine).toHaveBeenCalledTimes(1);
    expect(demoEngineMock.play).toHaveBeenCalledTimes(1);
  });

  it("creates exactly one Demo Track engine in combined mode", () => {
    render(<SessionVisualizerStage sync={syncFor("combined")} isAudioAuthority />);
    expect(DemoTrackEngine).toHaveBeenCalledTimes(1);
    expect(demoEngineMock.play).toHaveBeenCalledTimes(1);
  });

  it("publishes compact Demo Track envelopes from the controller", () => {
    const publishFeatures = vi.fn();
    render(
      <SessionVisualizerStage
        sync={syncFor("controller")}
        isAudioAuthority
        publishFeatures={publishFeatures}
      />,
    );
    act(() => {
      for (const listener of demoListeners) {
        listener({
          status: "playing",
          frame: {
            ...createSilentFeatureFrame(1, 32),
            energy: 0.55,
            rms: 0.4,
            bass: 0.3,
            mid: 0.2,
            high: 0.1,
          },
        });
      }
    });
    expect(publishFeatures).toHaveBeenCalled();
    const envelope = publishFeatures.mock.calls[0]?.[0] as AudioFeatureEnvelope;
    expect(envelope.frameSeq).toBeGreaterThan(1_000_000_000_000);
    expect(envelope.levels).toHaveLength(8);
    expect(envelope).not.toHaveProperty("bands");
    expect(JSON.stringify(envelope)).not.toMatch(
      /pcm|fft|microphone|MediaStream|frequencyData|video/,
    );
  });

  it("applies remote Demo Track envelopes without rerendering at 20 Hz", () => {
    let featureListener: ((envelope: AudioFeatureEnvelope) => void) | null = null;
    let stageRenders = 0;
    function Probe() {
      stageRenders += 1;
      return (
        <SessionVisualizerStage
          sync={syncFor("display")}
          isAudioAuthority={false}
          subscribeFeatures={(listener) => {
            featureListener = listener;
            return () => {
              featureListener = null;
            };
          }}
        />
      );
    }
    render(<Probe />);
    const rendersAfterMount = stageRenders;
    expect(screen.getByTestId("visualizer-host").getAttribute("data-has-resolver")).toBe("true");

    act(() => {
      for (let i = 1; i <= AUDIO_FEATURE_ENVELOPE_MAX_HZ; i += 1) {
        featureListener?.({
          ...createSilentFeatureEnvelope(i, Date.now()),
          energy: 0.8,
          rms: 0.7,
          bass: 0.6,
        });
      }
    });

    expect(stageRenders).toBe(rendersAfterMount);
    expect(screen.getByTestId("remote-feature-energy").getAttribute("data-energy")).not.toBe(
      "0.000",
    );
  });

  it("disposes the Demo Track engine when switching to Capture Music", () => {
    const { rerender } = render(
      <SessionVisualizerStage sync={syncFor("controller")} isAudioAuthority />,
    );
    expect(DemoTrackEngine).toHaveBeenCalledTimes(1);
    rerender(
      <SessionVisualizerStage
        sync={syncFor("controller", "live_listen")}
        isAudioAuthority
        captureEngine={captureEngineMock as never}
        captureSource="browser_capture"
      />,
    );
    expect(demoEngineMock.dispose).toHaveBeenCalled();
  });
});

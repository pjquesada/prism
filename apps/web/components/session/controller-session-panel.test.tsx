import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  applySessionMessage,
  createSyncEngineState,
  setConnectionStatus,
  setLocalIdentity,
  type SyncEngineState,
} from "@prism/sync-engine";
import type { SessionSnapshot } from "@prism/contracts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const publish = vi.fn(async () => undefined);
const restoreWithCookie = vi.fn(async () => undefined);
const rotatePairingCode = vi.fn();
const end = vi.fn();
const handoff = vi.fn();

let syncState: SyncEngineState;

vi.mock("next/navigation", () => ({
  useParams: () => ({ sessionId: SESSION_ID }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@prism/visualizers", () => ({
  listVisualizerPlugins: () => [
    { id: "spectrum", label: "Spectrum", description: "Spectrum bars" },
    { id: "particles", label: "Particles", description: "Particle field" },
    { id: "album_world", label: "Album World", description: "Album art world" },
  ],
  requireVisualizerPlugin: (id: string) => ({
    id,
    label: id === "particles" ? "Particles" : id === "album_world" ? "Album World" : "Spectrum",
  }),
}));

vi.mock("@/components/session/session-visualizer-stage", () => ({
  SessionVisualizerStage: () => <div data-testid="controller-stage">stage</div>,
}));

vi.mock("@/components/session/pairing-qr", () => ({
  PairingQr: () => null,
}));

vi.mock("@/lib/use-guest-preset-store", () => ({
  useGuestPresetStore: () => ({ users: [], error: null, replaceUsers: vi.fn() }),
}));

vi.mock("@/lib/session/use-session-client", () => ({
  takeSessionMeta: vi.fn(),
  useSessionClient: () => ({
    client: {
      restoreWithCookie,
      publish,
      publishFeatures: vi.fn(),
      subscribeFeatures: vi.fn(() => () => undefined),
      rotatePairingCode,
      end,
      handoff,
    },
    sync: syncState,
  }),
}));

import { ControllerSessionPanel } from "@/components/session/controller-session-panel";

function snapshot(
  visualizerId: "spectrum" | "particles" | "album_world" = "spectrum",
): SessionSnapshot {
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
    ],
    playback: {
      audioMode: "demo_track",
      isPlaying: false,
      positionMs: 0,
      rate: 1,
      trackId: "demo-track",
      updatedAt: now,
      seq: 2,
    },
    preset: {
      visualizerId,
      qualityTier: "high",
      presetId: `builtin-${visualizerId === "album_world" ? "album-world-drift" : visualizerId === "particles" ? "particles-pulse" : "spectrum-calm"}`,
      params: { sensitivity: 1 },
      updatedAt: now,
      seq: 2,
    },
  };
}

function connectedState(visualizerId: "spectrum" | "particles" | "album_world" = "spectrum") {
  let state = createSyncEngineState();
  state = setLocalIdentity(state, { deviceId: "controller-1", role: "controller" });
  state = applySessionMessage(state, {
    type: "session.snapshot",
    seq: 2,
    sentAt: new Date().toISOString(),
    sessionId: SESSION_ID,
    deviceId: "controller-1",
    payload: snapshot(visualizerId),
  }).state;
  return setConnectionStatus(state, "connected");
}

describe("ControllerSessionPanel visualizer selector", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    publish.mockReset();
    publish.mockResolvedValue(undefined);
    restoreWithCookie.mockReset();
    restoreWithCookie.mockResolvedValue(undefined);
    syncState = connectedState("spectrum");
  });

  it("shows Spectrum, Particles, and Album World from the registry", async () => {
    render(<ControllerSessionPanel />);
    expect(await screen.findByTestId("viz-spectrum")).toBeTruthy();
    expect(screen.getByTestId("viz-particles")).toBeTruthy();
    expect(screen.getByTestId("viz-album_world")).toBeTruthy();
    expect(screen.getByTestId("visualizer-selector").querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByTestId("active-visualizer").textContent).toMatch(/Spectrum/i);
    expect(screen.getByTestId("session-preset-controls")).toBeTruthy();
    expect(screen.getByTestId("param-sensitivity")).toBeTruthy();
  });

  it("selecting Particles updates the controller state", async () => {
    render(<ControllerSessionPanel />);
    const particles = await screen.findByTestId("viz-particles");
    fireEvent.click(particles);
    expect(particles.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("active-visualizer").textContent).toMatch(/Particles/i);
    await waitFor(() => {
      expect(publish).toHaveBeenCalled();
    });
    const applied = publish.mock.calls.some((call) => {
      const message = call[0] as { type?: string; payload?: { visualizerId?: string } };
      return (
        (message.type === "preset.apply" || message.type === "visual.intent") &&
        message.payload?.visualizerId === "particles"
      );
    });
    expect(applied).toBe(true);
  });

  it("rolls back and shows an error when persistence fails", async () => {
    publish.mockRejectedValue(new Error("backend_unavailable"));
    render(<ControllerSessionPanel />);
    fireEvent.click(await screen.findByTestId("viz-particles"));
    expect(await screen.findByTestId("controller-sync-error")).toBeTruthy();
    expect(screen.getByTestId("viz-spectrum").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("viz-particles").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("sync-save-state").textContent).toMatch(/Save failed/i);
    expect(screen.queryByText(/Restoring session/i)).toBeNull();
  });

  it("publishes a Live Listen playback mode without microphone payloads", async () => {
    render(<ControllerSessionPanel />);
    fireEvent.click(await screen.findByTestId("audio-mode-live_listen"));
    await waitFor(() => {
      expect(publish).toHaveBeenCalled();
    });
    const message = publish.mock.calls.find((call) => {
      const payload = call[0] as { type?: string; payload?: { audioMode?: string } };
      return payload.type === "playback.update" && payload.payload?.audioMode === "live_listen";
    })?.[0] as Record<string, unknown>;
    expect(message).toBeTruthy();
    expect(JSON.stringify(message)).not.toMatch(/pcm|microphone|MediaStream|getUserMedia/);
  });
});

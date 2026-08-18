"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultParamsForVisualizer,
  type DisplayMode,
  type PlaybackState,
  type VisualizerId,
} from "@prism/contracts";

import { ConnectionBanner } from "@/components/session/connection-banner";
import { PairingQr } from "@/components/session/pairing-qr";
import { SessionVisualizerStage } from "@/components/session/session-visualizer-stage";
import { takeSessionMeta, useSessionClient } from "@/lib/session/use-session-client";

const VISUALIZERS: { id: VisualizerId; label: string }[] = [
  { id: "spectrum", label: "Spectrum" },
  { id: "particles", label: "Particles" },
  { id: "album_world", label: "Album World" },
];

export function ControllerSessionPanel() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { client, sync } = useSessionClient();
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreStarted, setRestoreStarted] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const attemptedSessionRef = useRef<string | null>(null);

  const restore = useCallback(() => {
    if (!sessionId) return;
    setRestoreError(null);
    setRestoreStarted(true);
    takeSessionMeta(sessionId);
    void client.restoreWithCookie(sessionId).catch((err) => {
      setRestoreError(err instanceof Error ? err.message : "restore_failed");
    });
  }, [client, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (attemptedSessionRef.current === sessionId) return;
    attemptedSessionRef.current = sessionId;
    restore();
  }, [restore, sessionId]);

  const retry = () => {
    attemptedSessionRef.current = null;
    restore();
  };

  const publishVisual = useCallback(
    async (patch: {
      visualizerId?: VisualizerId;
      displayMode?: DisplayMode;
      params?: Record<string, unknown>;
    }) => {
      if (!sync.localDeviceId) return;
      try {
        await client.publish({
          type: "visual.intent",
          sessionId,
          deviceId: sync.localDeviceId,
          payload: patch,
        });
      } catch (err) {
        setRestoreError(err instanceof Error ? `publish:${err.message}` : "broadcast_failed");
      }
    },
    [client, sessionId, sync.localDeviceId],
  );

  const onPlaybackAnchor = useCallback(
    (playback: PlaybackState) => {
      if (!sync.localDeviceId) return;
      void client.publish({
        type: "playback.update",
        sessionId,
        deviceId: sync.localDeviceId,
        payload: playback,
      });
    },
    [client, sessionId, sync.localDeviceId],
  );

  const isController = sync.localRole === "controller" || sync.localRole === "combined";
  const restoreFailed =
    Boolean(restoreError) ||
    sync.connection === "error" ||
    sync.connection === "offline" ||
    sync.connection === "unauthorized";

  if (!restoreStarted || (sync.connection === "connecting" && !sync.snapshot && !restoreError)) {
    return (
      <div className="flex flex-col gap-4">
        <ConnectionBanner status={sync.connection === "idle" ? "connecting" : sync.connection} />
        <p className="text-prism-mist" role="status">
          Restoring session…
        </p>
      </div>
    );
  }

  if (restoreError === "unauthorized" || sync.connection === "unauthorized") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-prism-ember" role="alert" data-testid="restore-error">
          Unauthorized for this session. Start or join again.
        </p>
        <Link href="/start" className="prism-btn prism-btn-primary w-fit">
          Start a session
        </Link>
      </div>
    );
  }

  if (restoreFailed && !sync.snapshot) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-prism-ember" role="alert" data-testid="restore-error">
          Could not restore the session. Check your connection and retry.
        </p>
        <button
          type="button"
          className="prism-btn prism-btn-primary w-fit"
          data-testid="restore-retry"
          onClick={retry}
        >
          Retry
        </button>
        <Link href="/start" className="prism-btn prism-btn-ghost w-fit">
          Start a session
        </Link>
      </div>
    );
  }

  if (sync.connection === "ended" || sync.snapshot?.session.status === "ended") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-prism-ember" role="status">
          This session has ended.
        </p>
        <Link href="/start" className="prism-btn prism-btn-primary w-fit">
          Start a new session
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ConnectionBanner status={sync.connection} />

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-sm uppercase tracking-[0.14em] text-prism-aurora">Controller</p>
          <h1 className="mt-2 font-display text-4xl font-semibold text-prism-foam">Session</h1>
          <p className="mt-2 font-mono text-sm text-prism-mist" data-testid="controller-session-id">
            {sessionId}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-6">
          {pairingCode ? (
            <div>
              <p className="text-sm text-prism-mist">Code</p>
              <p
                className="font-display text-3xl tracking-[0.18em]"
                data-testid="controller-pairing-code"
              >
                {pairingCode}
              </p>
              {pairingExpiresAt ? (
                <p className="mt-1 text-xs text-prism-mist">
                  Expires {new Date(pairingExpiresAt).toLocaleTimeString()}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="max-w-xs text-sm text-prism-mist">
              Pairing codes are shown once. Generate a new code to invite displays.
            </p>
          )}
          {joinUrl ? <PairingQr joinUrl={joinUrl} label="Display QR" /> : null}
          <button
            type="button"
            className="prism-btn prism-btn-ghost"
            disabled={!isController || rotating}
            data-testid="rotate-pairing-code"
            onClick={() => {
              setRotating(true);
              void client
                .rotatePairingCode()
                .then((rotated) => {
                  setPairingCode(rotated.pairingCode);
                  setJoinUrl(rotated.joinUrl);
                  setPairingExpiresAt(rotated.pairingExpiresAt);
                })
                .catch((err) => {
                  setRestoreError(err instanceof Error ? err.message : "rotate_failed");
                })
                .finally(() => setRotating(false));
            }}
          >
            {rotating ? "Generating…" : pairingCode ? "Rotate code" : "Generate pairing code"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3" role="group" aria-label="Visualizer">
        {VISUALIZERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={
              sync.snapshot?.preset.visualizerId === option.id
                ? "prism-btn prism-btn-primary"
                : "prism-btn prism-btn-ghost"
            }
            data-testid={`viz-${option.id}`}
            disabled={!isController}
            aria-pressed={sync.snapshot?.preset.visualizerId === option.id}
            onClick={() => {
              void publishVisual({
                visualizerId: option.id,
                params: defaultParamsForVisualizer(option.id),
              });
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3" role="group" aria-label="Display mode">
        {(["mirror", "complementary"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={
              sync.snapshot?.session.displayMode === mode
                ? "prism-btn prism-btn-primary"
                : "prism-btn prism-btn-ghost"
            }
            disabled={!isController}
            onClick={() => void publishVisual({ displayMode: mode })}
          >
            {mode === "mirror" ? "Mirror" : "Complementary"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="prism-btn prism-btn-primary"
          disabled={!isController || !sync.localDeviceId}
          onClick={() => {
            if (!sync.localDeviceId || !sync.snapshot) return;
            const playing = !sync.snapshot.playback.isPlaying;
            void client.publish({
              type: "playback.update",
              sessionId,
              deviceId: sync.localDeviceId,
              payload: {
                ...sync.snapshot.playback,
                isPlaying: playing,
                updatedAt: new Date().toISOString(),
              },
            });
          }}
        >
          {sync.snapshot?.playback.isPlaying ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className="prism-btn prism-btn-ghost"
          disabled={!isController}
          onClick={() => {
            void client.end();
          }}
        >
          End session
        </button>
        <Link href={`/display/${sessionId}`} className="prism-btn prism-btn-ghost">
          Open display
        </Link>
      </div>

      {sync.snapshot && sync.snapshot.devices.length > 1 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-prism-mist">Devices</p>
          <ul className="flex flex-col gap-2">
            {sync.snapshot.devices.map((device) => (
              <li
                key={device.deviceId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-prism-slate/80 px-3 py-2 text-sm"
              >
                <span>
                  {device.deviceId.slice(0, 10)}… · {device.role}
                  {device.isOnline ? "" : " (offline)"}
                </span>
                {isController && device.deviceId !== sync.localDeviceId ? (
                  <button
                    type="button"
                    className="prism-btn prism-btn-ghost"
                    onClick={() => void client.handoff(device.deviceId)}
                  >
                    Hand off
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {restoreError && restoreError !== "unauthorized" ? (
        <p className="text-sm text-prism-ember" role="alert">
          Could not restore session ({restoreError}).
        </p>
      ) : null}

      <SessionVisualizerStage
        sync={sync}
        isAudioAuthority={isController}
        onPlaybackAnchor={onPlaybackAnchor}
      />
    </div>
  );
}

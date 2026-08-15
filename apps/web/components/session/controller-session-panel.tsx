"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  defaultParamsForVisualizer,
  type DisplayMode,
  type GuestCredential,
  type PlaybackState,
  type VisualizerId,
} from "@prism/contracts";

import { ConnectionBanner } from "@/components/session/connection-banner";
import { PairingQr } from "@/components/session/pairing-qr";
import { SessionVisualizerStage } from "@/components/session/session-visualizer-stage";
import {
  loadStoredCredential,
  storeCredential,
  useSessionClient,
} from "@/lib/session/use-session-client";

const VISUALIZERS: { id: VisualizerId; label: string }[] = [
  { id: "spectrum", label: "Spectrum" },
  { id: "particles", label: "Particles" },
  { id: "album_world", label: "Album World" },
];

function subscribeNoop(): () => void {
  return () => undefined;
}

function readCredentialJson(sessionId: string): string | null {
  const cred = loadStoredCredential();
  if (!cred || cred.sessionId !== sessionId) return null;
  return JSON.stringify(cred);
}

export function ControllerSessionPanel() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { client, sync } = useSessionClient();
  const credentialJson = useSyncExternalStore(
    subscribeNoop,
    () => readCredentialJson(sessionId),
    () => null,
  );
  const credential = credentialJson ? (JSON.parse(credentialJson) as GuestCredential) : null;
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    if (!credential) return;
    void client.restore(credential).catch((err) => {
      setRestoreError(err instanceof Error ? err.message : "restore_failed");
    });
  }, [client, credential]);

  const joinUrl =
    sync.snapshot?.pairingCode && typeof window !== "undefined"
      ? `${window.location.origin}/join?code=${encodeURIComponent(sync.snapshot.pairingCode)}`
      : null;

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

  if (!credential || restoreError === "unauthorized" || sync.connection === "unauthorized") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-prism-ember" role="alert">
          Unauthorized for this session. Start or join again.
        </p>
        <Link href="/start" className="prism-btn prism-btn-primary w-fit">
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
        {sync.snapshot?.pairingCode ? (
          <div className="flex flex-wrap items-start gap-6">
            <div>
              <p className="text-sm text-prism-mist">Code</p>
              <p
                className="font-display text-3xl tracking-[0.18em]"
                data-testid="controller-pairing-code"
              >
                {sync.snapshot.pairingCode}
              </p>
            </div>
            {joinUrl ? <PairingQr joinUrl={joinUrl} label="Display QR" /> : null}
          </div>
        ) : null}
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
            void client.end().then(() => storeCredential(null));
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

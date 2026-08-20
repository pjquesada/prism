"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createBuiltInPresets,
  defaultParamsForVisualizer,
  mergeActivePresetSnapshot,
  parseVisualizerParams,
  type ActivePresetSnapshot,
  type AudioMode,
  type DisplayMode,
  type PlaybackState,
  type PresetConfig,
  type VisualizerId,
} from "@prism/contracts";
import { LiveListenEngine } from "@prism/audio-engine";
import type { SyncEngineState } from "@prism/sync-engine";

import { AudioModeSelector } from "@/components/audio-mode-selector";
import { ConnectionBanner } from "@/components/session/connection-banner";
import { PairingQr } from "@/components/session/pairing-qr";
import { SessionPresetControls } from "@/components/session/session-preset-controls";
import { SessionVisualizerStage } from "@/components/session/session-visualizer-stage";
import { SessionSyncStatus, type SyncSaveState } from "@/components/session/session-sync-status";
import { VisualizerSelector } from "@/components/visualizer-selector";
import { takeSessionMeta, useSessionClient } from "@/lib/session/use-session-client";
import { isLiveListenEnabled } from "@/lib/live-listen-enabled";

const PARAM_DEBOUNCE_MS = 250;

function builtinFor(visualizerId: VisualizerId): PresetConfig | undefined {
  return createBuiltInPresets().find((preset) => preset.visualizerId === visualizerId);
}

export function ControllerSessionPanel() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { client, sync } = useSessionClient();
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SyncSaveState>("saved");
  const [restoreStarted, setRestoreStarted] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [optimisticPreset, setOptimisticPreset] = useState<ActivePresetSnapshot | null>(null);
  const [optimisticDisplayMode, setOptimisticDisplayMode] = useState<DisplayMode | null>(null);
  const attemptedSessionRef = useRef<string | null>(null);
  const publishGenRef = useRef(0);
  const paramTimerRef = useRef<number | null>(null);
  const [liveListenEngine, setLiveListenEngine] = useState<LiveListenEngine | null>(null);
  const liveListenEngineRef = useRef<LiveListenEngine | null>(null);

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

  useEffect(() => {
    return () => {
      if (paramTimerRef.current) window.clearTimeout(paramTimerRef.current);
      void liveListenEngineRef.current?.dispose();
      liveListenEngineRef.current = null;
    };
  }, []);

  const retry = () => {
    attemptedSessionRef.current = null;
    restore();
  };

  const isController = sync.localRole === "controller" || sync.localRole === "combined";
  const confirmedPreset = sync.snapshot?.preset ?? null;
  const viewPreset = optimisticPreset ?? confirmedPreset;
  const viewDisplayMode = optimisticDisplayMode ?? sync.snapshot?.session.displayMode ?? "mirror";
  const viewSync: SyncEngineState = useMemo(() => {
    if (!sync.snapshot || (!optimisticPreset && !optimisticDisplayMode)) return sync;
    return {
      ...sync,
      snapshot: {
        ...sync.snapshot,
        preset: optimisticPreset ?? sync.snapshot.preset,
        session: {
          ...sync.snapshot.session,
          displayMode: viewDisplayMode,
        },
      },
    };
  }, [sync, optimisticPreset, optimisticDisplayMode, viewDisplayMode]);

  const runPublish = useCallback(
    async (
      work: () => Promise<void>,
      nextPreset?: ActivePresetSnapshot,
      nextMode?: DisplayMode,
    ) => {
      if (!sync.localDeviceId) return;
      const gen = ++publishGenRef.current;
      if (nextPreset) setOptimisticPreset(nextPreset);
      if (nextMode) setOptimisticDisplayMode(nextMode);
      setSaveState("saving");
      setSyncError(null);
      try {
        await work();
        if (gen !== publishGenRef.current) return;
        setOptimisticPreset(null);
        setOptimisticDisplayMode(null);
        setSaveState("saved");
      } catch (err) {
        if (gen !== publishGenRef.current) return;
        setOptimisticPreset(null);
        setOptimisticDisplayMode(null);
        setSaveState("error");
        setSyncError(err instanceof Error ? err.message : "broadcast_failed");
      }
    },
    [sync.localDeviceId],
  );

  const publishVisualizer = useCallback(
    (visualizerId: VisualizerId) => {
      if (!sync.localDeviceId || !confirmedPreset) return;
      const builtin = builtinFor(visualizerId);
      const next = mergeActivePresetSnapshot(
        confirmedPreset,
        {
          visualizerId,
          params: builtin?.params ?? defaultParamsForVisualizer(visualizerId),
          presetId: builtin?.id ?? null,
        },
        confirmedPreset.seq,
        new Date().toISOString(),
      );
      void runPublish(async () => {
        await client.publish({
          type: "preset.apply",
          sessionId,
          deviceId: sync.localDeviceId!,
          payload: next,
        });
      }, next);
    },
    [client, confirmedPreset, runPublish, sessionId, sync.localDeviceId],
  );

  const publishPreset = useCallback(
    (preset: PresetConfig) => {
      if (!sync.localDeviceId || !confirmedPreset) return;
      const next = mergeActivePresetSnapshot(
        confirmedPreset,
        {
          visualizerId: preset.visualizerId,
          params: parseVisualizerParams(preset.visualizerId, preset.params),
          presetId: preset.id,
        },
        confirmedPreset.seq,
        new Date().toISOString(),
      );
      void runPublish(async () => {
        await client.publish({
          type: "preset.apply",
          sessionId,
          deviceId: sync.localDeviceId!,
          payload: next,
        });
      }, next);
    },
    [client, confirmedPreset, runPublish, sessionId, sync.localDeviceId],
  );

  const publishParamsNow = useCallback(
    (params: Record<string, unknown>, base: ActivePresetSnapshot) => {
      if (!sync.localDeviceId) return;
      const next = mergeActivePresetSnapshot(
        base,
        { params: parseVisualizerParams(base.visualizerId, params) },
        base.seq,
        new Date().toISOString(),
      );
      void runPublish(async () => {
        await client.publish({
          type: "visual.intent",
          sessionId,
          deviceId: sync.localDeviceId!,
          payload: {
            visualizerId: next.visualizerId,
            qualityTier: next.qualityTier,
            params: next.params,
          },
        });
      }, next);
    },
    [client, runPublish, sessionId, sync.localDeviceId],
  );

  const onParamsChange = useCallback(
    (params: Record<string, unknown>) => {
      const base = viewPreset;
      if (!base) return;
      const next = mergeActivePresetSnapshot(
        base,
        { params: parseVisualizerParams(base.visualizerId, params) },
        base.seq,
        new Date().toISOString(),
      );
      setOptimisticPreset(next);
      setSaveState("saving");
      if (paramTimerRef.current) window.clearTimeout(paramTimerRef.current);
      paramTimerRef.current = window.setTimeout(() => {
        publishParamsNow(params, next);
      }, PARAM_DEBOUNCE_MS);
    },
    [publishParamsNow, viewPreset],
  );

  const publishDisplayMode = useCallback(
    (displayMode: DisplayMode) => {
      if (!sync.localDeviceId) return;
      void runPublish(
        async () => {
          await client.publish({
            type: "visual.intent",
            sessionId,
            deviceId: sync.localDeviceId!,
            payload: { displayMode },
          });
        },
        undefined,
        displayMode,
      );
    },
    [client, runPublish, sessionId, sync.localDeviceId],
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

  const startLiveListenFromGesture = useCallback(() => {
    let engine = liveListenEngineRef.current;
    if (!engine) {
      engine = new LiveListenEngine();
      liveListenEngineRef.current = engine;
      setLiveListenEngine(engine);
    }
    void engine.start();
    return engine;
  }, []);

  const stopLiveListen = useCallback(() => {
    const engine = liveListenEngineRef.current;
    liveListenEngineRef.current = null;
    setLiveListenEngine(null);
    if (engine) void engine.dispose();
  }, []);

  const publishAudioMode = useCallback(
    (audioMode: AudioMode) => {
      if (!sync.localDeviceId || !sync.snapshot) return;
      const live = audioMode === "live_listen";
      if (live) {
        startLiveListenFromGesture();
      } else {
        stopLiveListen();
      }
      void client.publish({
        type: "playback.update",
        sessionId,
        deviceId: sync.localDeviceId,
        payload: {
          ...sync.snapshot.playback,
          audioMode,
          isPlaying: live ? true : sync.snapshot.playback.isPlaying,
          trackId: live ? "live-listen" : "demo-track",
          positionMs: live ? 0 : sync.snapshot.playback.positionMs,
          updatedAt: new Date().toISOString(),
        },
      });
    },
    [
      client,
      sessionId,
      startLiveListenFromGesture,
      stopLiveListen,
      sync.localDeviceId,
      sync.snapshot,
    ],
  );

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
      <div className="sticky top-0 z-20 -mx-4 border-b border-prism-slate/80 bg-prism-ink/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-[0.14em] text-prism-aurora">Controller</p>
              <h1 className="mt-1 font-display text-3xl font-semibold text-prism-foam sm:text-4xl">
                Session
              </h1>
              <p
                className="mt-1 font-mono text-sm text-prism-mist"
                data-testid="controller-session-id"
              >
                {sessionId}
              </p>
            </div>
            {viewPreset ? (
              <SessionSyncStatus
                visualizerId={viewPreset.visualizerId}
                connection={sync.connection}
                saveState={saveState}
                seq={viewPreset.seq}
              />
            ) : null}
          </div>
          {viewPreset ? (
            <VisualizerSelector
              value={viewPreset.visualizerId}
              disabled={!isController}
              onSelect={publishVisualizer}
            />
          ) : null}
        </div>
      </div>

      <ConnectionBanner status={sync.connection} />

      <div className="flex flex-wrap items-start justify-between gap-6">
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

      <AudioModeSelector
        value={sync.snapshot?.playback.audioMode ?? "demo_track"}
        allowLiveListen={isLiveListenEnabled()}
        disabled={!isController}
        onSelect={publishAudioMode}
      />

      <div className="flex flex-wrap gap-3" role="group" aria-label="Display mode">
        {(["mirror", "complementary"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={
              viewDisplayMode === mode ? "prism-btn prism-btn-primary" : "prism-btn prism-btn-ghost"
            }
            disabled={!isController}
            onClick={() => void publishDisplayMode(mode)}
          >
            {mode === "mirror" ? "Mirror" : "Complementary"}
          </button>
        ))}
      </div>

      {viewPreset ? (
        <SessionPresetControls
          preset={viewPreset}
          disabled={!isController}
          onApplyPreset={publishPreset}
          onParamsChange={onParamsChange}
        />
      ) : null}

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

      {syncError ? (
        <p className="text-sm text-prism-ember" role="alert" data-testid="controller-sync-error">
          Could not sync visualizer ({syncError}). The previous visualizer was restored.
        </p>
      ) : null}

      {restoreError && restoreError !== "unauthorized" ? (
        <p className="text-sm text-prism-ember" role="alert">
          Could not restore session ({restoreError}).
        </p>
      ) : null}

      <SessionVisualizerStage
        sync={viewSync}
        isAudioAuthority={isController}
        onPlaybackAnchor={onPlaybackAnchor}
        liveListenEngine={liveListenEngine}
        subscribeFeatures={(listener) => client.subscribeFeatures(listener)}
        publishFeatures={(envelope) => client.publishFeatures(envelope)}
        onStartLiveListen={startLiveListenFromGesture}
      />
    </div>
  );
}

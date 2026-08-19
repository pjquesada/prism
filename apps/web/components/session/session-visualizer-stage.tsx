"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSilentFeatureFrame,
  defaultParamsForVisualizer,
  parseVisualizerParams,
  type ActivePresetSnapshot,
  type AudioFeatureFrame,
  type PlaybackState,
  type QualityTier,
  type VisualizerId,
} from "@prism/contracts";
import {
  DemoTrackEngine,
  LiveListenEngine,
  type LiveListenEngineStatus,
} from "@prism/audio-engine";
import { VisualizerCanvas } from "@prism/visual-engine";
import { requireVisualizerPlugin } from "@prism/visualizers";
import {
  applyDisplayModeParams,
  correctPlaybackDrift,
  displayDeviceIndex,
  type SyncEngineState,
} from "@prism/sync-engine";

import { LiveListenStatusPanel } from "@/components/live-listen-status";
import { PLACEHOLDER_ARTWORK_PATH } from "@/lib/local-artwork";

const DEMO_TRACK_URL = "/audio/demo-track.wav";

type SessionVisualizerStageProps = {
  sync: SyncEngineState;
  /** When true, this device owns Demo Track / Live Listen analysis. */
  isAudioAuthority: boolean;
  onPlaybackAnchor?: (playback: PlaybackState) => void;
  className?: string;
};

export function SessionVisualizerStage({
  sync,
  isAudioAuthority,
  onPlaybackAnchor,
  className,
}: SessionVisualizerStageProps) {
  const snapshot = sync.snapshot;
  const engineRef = useRef<DemoTrackEngine | null>(null);
  const liveEngineRef = useRef<LiveListenEngine | null>(null);
  const featuresRef = useRef<AudioFeatureFrame>(createSilentFeatureFrame());
  const [engineReady, setEngineReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveListenEngineStatus>("idle");
  const [liveError, setLiveError] = useState<string | undefined>();
  const lastAnchorRef = useRef(0);

  const preset: ActivePresetSnapshot | null = snapshot?.preset ?? null;
  const visualizerId: VisualizerId =
    preset?.visualizerId === "dreamscape" ? "spectrum" : (preset?.visualizerId ?? "spectrum");
  const quality: QualityTier = preset?.qualityTier ?? "high";
  const audioMode = snapshot?.playback.audioMode ?? "demo_track";
  const liveListen = audioMode === "live_listen";
  const sessionId = snapshot?.session.id;
  const followerSilent = liveListen && !isAudioAuthority;
  const ready = followerSilent || engineReady;
  const deviceIndex = snapshot ? displayDeviceIndex(snapshot.devices, sync.localDeviceId ?? "") : 0;
  const params = useMemo(() => {
    const base = parseVisualizerParams(
      visualizerId,
      preset?.params ?? defaultParamsForVisualizer(visualizerId),
    );
    return applyDisplayModeParams(base, snapshot?.session.displayMode ?? "mirror", deviceIndex);
  }, [visualizerId, preset?.params, snapshot?.session.displayMode, deviceIndex]);

  const plugin = useMemo(() => requireVisualizerPlugin(visualizerId), [visualizerId]);

  useEffect(() => {
    if (!sessionId || liveListen) {
      engineRef.current = null;
      return;
    }
    const engine = new DemoTrackEngine({ trackUrl: DEMO_TRACK_URL, loop: true });
    engineRef.current = engine;
    const unsubscribe = engine.subscribe((event) => {
      featuresRef.current = event.frame;
      setEngineReady(
        event.status === "ready" ||
          event.status === "playing" ||
          event.status === "paused" ||
          event.status === "needs_gesture",
      );
      setNeedsGesture(event.status === "needs_gesture");
      if (event.status === "error") setError(event.errorMessage ?? "Audio error");
      if (event.status === "unsupported") setError("Web Audio unsupported");
    });
    void engine.prepare();
    return () => {
      unsubscribe();
      void engine.dispose();
      engineRef.current = null;
    };
  }, [liveListen, sessionId]);

  useEffect(() => {
    if (!sessionId || !liveListen) {
      liveEngineRef.current = null;
      return;
    }
    if (!isAudioAuthority) {
      featuresRef.current = createSilentFeatureFrame();
      return;
    }
    const engine = new LiveListenEngine();
    liveEngineRef.current = engine;
    const unsubscribe = engine.subscribe((event) => {
      featuresRef.current = event.frame;
      setLiveStatus(event.status);
      setLiveError(event.errorMessage);
      setEngineReady(
        event.status === "listening" || event.status === "paused" || event.status === "requesting",
      );
      setNeedsGesture(false);
    });
    void engine.start();
    return () => {
      unsubscribe();
      void engine.dispose();
      liveEngineRef.current = null;
    };
  }, [liveListen, isAudioAuthority, sessionId]);

  useEffect(() => {
    const playback = snapshot?.playback;
    if (!playback) return;

    if (liveListen) {
      const live = liveEngineRef.current;
      if (!isAudioAuthority || !live) return;
      if (playback.isPlaying) void live.start();
      else void live.pause();
      return;
    }

    const engine = engineRef.current;
    if (!engine) return;

    if (isAudioAuthority) {
      if (playback.isPlaying) void engine.play();
      else void engine.pause();
      return;
    }

    const correction = correctPlaybackDrift({
      playback,
      localPositionMs: engine.getPositionMs(),
      sessionNowMs: Date.now() + sync.clock.offsetMs,
    });

    if (playback.isPlaying) {
      void engine.play();
      if (correction.correction === "seek") {
        engine.setPositionMs(correction.positionMs);
        engine.setPlaybackRate(playback.rate);
      } else if (correction.correction === "nudge") {
        engine.setPlaybackRate(correction.suggestedRate);
      } else {
        engine.setPlaybackRate(playback.rate);
      }
    } else {
      void engine.pause();
      engine.setPositionMs(playback.positionMs);
    }
  }, [snapshot?.playback, isAudioAuthority, sync.clock.offsetMs, liveListen]);

  useEffect(() => {
    if (!isAudioAuthority || !onPlaybackAnchor || !snapshot) return;
    const id = window.setInterval(() => {
      const playback = snapshot.playback;
      const now = Date.now();
      if (playback.audioMode === "live_listen") {
        const live = liveEngineRef.current;
        if (!live) return;
        if (now - lastAnchorRef.current < 1800 && live.getStatus() === "listening") return;
        lastAnchorRef.current = now;
        onPlaybackAnchor({
          audioMode: "live_listen",
          isPlaying: live.getStatus() === "listening",
          positionMs: 0,
          rate: 1,
          trackId: "live-listen",
          updatedAt: new Date().toISOString(),
          seq: playback.seq,
        });
        return;
      }
      const engine = engineRef.current;
      if (!engine) return;
      const status = engine.getStatus();
      if (now - lastAnchorRef.current < 1800 && status === "playing") return;
      lastAnchorRef.current = now;
      onPlaybackAnchor({
        audioMode: "demo_track",
        isPlaying: status === "playing",
        positionMs: engine.getPositionMs(),
        rate: engine.getPlaybackRate(),
        trackId: "demo-track",
        updatedAt: new Date().toISOString(),
        seq: playback.seq,
      });
    }, 2000);
    return () => window.clearInterval(id);
  }, [isAudioAuthority, onPlaybackAnchor, snapshot, liveListen]);

  if (!snapshot) {
    return (
      <div className={className} role="status">
        <p className="text-prism-mist">Waiting for session snapshot…</p>
      </div>
    );
  }

  return (
    <div className={className}>
      {!ready && !error ? (
        <p className="mb-3 text-sm text-prism-mist" role="status">
          Loading visualizer…
        </p>
      ) : null}
      {error ? (
        <p className="mb-3 text-sm text-prism-ember" role="alert">
          {error}
        </p>
      ) : null}
      {needsGesture && !liveListen ? (
        <button
          type="button"
          className="prism-btn prism-btn-primary mb-3"
          onClick={() => void engineRef.current?.play()}
        >
          Enable audio on this display
        </button>
      ) : null}
      {liveListen && !isAudioAuthority ? (
        <p
          className="mb-3 text-sm text-prism-mist"
          role="status"
          data-testid="live-listen-follower"
        >
          Controller is using Live Listen. This display does not capture a microphone; visuals
          follow preset only.
        </p>
      ) : null}
      <div className="relative min-h-[min(70vh,36rem)] overflow-hidden rounded-sm border border-prism-slate bg-prism-deep/70">
        {liveListen && isAudioAuthority ? (
          <LiveListenStatusPanel
            status={liveStatus}
            errorMessage={liveError}
            onRetry={() => {
              void liveEngineRef.current?.start();
            }}
            onUseDemoTrack={() => {
              onPlaybackAnchor?.({
                ...snapshot.playback,
                audioMode: "demo_track",
                trackId: "demo-track",
                updatedAt: new Date().toISOString(),
              });
            }}
          />
        ) : null}
        <VisualizerCanvas
          plugin={plugin}
          featuresRef={featuresRef}
          quality={quality}
          params={params}
          albumArtUrl={visualizerId === "album_world" ? PLACEHOLDER_ARTWORK_PATH : null}
        />
      </div>
    </div>
  );
}

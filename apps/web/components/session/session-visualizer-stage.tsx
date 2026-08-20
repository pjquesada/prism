"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AUDIO_FEATURE_ENVELOPE_INTERVAL_MS,
  audioFeatureFrameToEnvelope,
  createSilentFeatureFrame,
  defaultParamsForVisualizer,
  parseVisualizerParams,
  type ActivePresetSnapshot,
  type AudioFeatureEnvelope,
  type AudioFeatureFrame,
  type PlaybackState,
  type QualityTier,
  type VisualizerId,
} from "@prism/contracts";
import {
  DemoTrackEngine,
  RemoteFeatureInterpolator,
  type LiveListenEngine,
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
import { VisualizerStageFrame } from "@/components/visualizer-stage-frame";
import { PLACEHOLDER_ARTWORK_PATH } from "@/lib/local-artwork";

const DEMO_TRACK_URL = "/audio/demo-track.wav";
const LIVE_LISTEN_PRIVACY =
  "Microphone audio stays on this device. Only anonymous visualization levels are shared with your paired display.";

type SessionVisualizerStageProps = {
  sync: SyncEngineState;
  /** When true, this device owns Demo Track / Live Listen analysis. */
  isAudioAuthority: boolean;
  onPlaybackAnchor?: (playback: PlaybackState) => void;
  className?: string;
  immersive?: boolean;
  /** Controller-owned engine started from a user gesture. Displays must omit this. */
  liveListenEngine?: LiveListenEngine | null;
  subscribeFeatures?: (listener: (envelope: AudioFeatureEnvelope) => void) => () => void;
  publishFeatures?: (envelope: AudioFeatureEnvelope) => void;
  onStartLiveListen?: () => void;
};

export function SessionVisualizerStage({
  sync,
  isAudioAuthority,
  onPlaybackAnchor,
  className,
  immersive = false,
  liveListenEngine = null,
  subscribeFeatures,
  publishFeatures,
  onStartLiveListen,
}: SessionVisualizerStageProps) {
  const snapshot = sync.snapshot;
  const engineRef = useRef<DemoTrackEngine | null>(null);
  const featuresRef = useRef<AudioFeatureFrame>(createSilentFeatureFrame());
  const interpolatorRef = useRef(new RemoteFeatureInterpolator());
  const remoteRafRef = useRef<number | null>(null);
  const frameSeqRef = useRef(0);
  const lastPublishMsRef = useRef(0);
  const [engineReady, setEngineReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveListenEngineStatus>("idle");
  const [liveError, setLiveError] = useState<string | undefined>();
  const [remoteEnergy, setRemoteEnergy] = useState(0);
  const lastAnchorRef = useRef(0);

  const preset: ActivePresetSnapshot | null = snapshot?.preset ?? null;
  const visualizerId: VisualizerId =
    preset?.visualizerId === "dreamscape" ? "spectrum" : (preset?.visualizerId ?? "spectrum");
  const quality: QualityTier = preset?.qualityTier ?? "high";
  const audioMode = snapshot?.playback.audioMode ?? "demo_track";
  const liveListen = audioMode === "live_listen";
  const sessionId = snapshot?.session.id;
  const followerSilent = liveListen && !isAudioAuthority;
  const ready = followerSilent || engineReady || liveStatus === "listening";
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
    if (!sessionId || !liveListen || !isAudioAuthority || !liveListenEngine) return;
    const engine = liveListenEngine;
    const unsubscribe = engine.subscribe((event) => {
      featuresRef.current = event.frame;
      setLiveStatus(event.status);
      setLiveError(event.errorMessage);
      setEngineReady(
        event.status === "listening" || event.status === "paused" || event.status === "requesting",
      );
      setNeedsGesture(event.status === "idle" || event.status === "inactive");
      if (event.status !== "listening" || !publishFeatures) return;
      const now = Date.now();
      if (now - lastPublishMsRef.current < AUDIO_FEATURE_ENVELOPE_INTERVAL_MS) return;
      lastPublishMsRef.current = now;
      frameSeqRef.current += 1;
      const envelope = audioFeatureFrameToEnvelope(event.frame, frameSeqRef.current, now);
      publishFeatures(envelope);
    });
    return () => {
      unsubscribe();
    };
  }, [liveListen, isAudioAuthority, sessionId, liveListenEngine, publishFeatures]);

  useEffect(() => {
    const interpolator = interpolatorRef.current;
    if (!liveListen || isAudioAuthority || !subscribeFeatures) {
      interpolator.reset();
      if (remoteRafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(remoteRafRef.current);
        remoteRafRef.current = null;
      }
      return;
    }
    featuresRef.current = createSilentFeatureFrame();
    const unsubscribe = subscribeFeatures((envelope) => {
      interpolator.ingest(envelope, Date.now());
    });
    const tick = () => {
      remoteRafRef.current = window.requestAnimationFrame(tick);
      const frame = interpolator.sample(Date.now());
      featuresRef.current = frame;
      setRemoteEnergy(frame.energy);
    };
    remoteRafRef.current = window.requestAnimationFrame(tick);
    return () => {
      unsubscribe();
      if (remoteRafRef.current !== null) {
        window.cancelAnimationFrame(remoteRafRef.current);
        remoteRafRef.current = null;
      }
      interpolator.reset();
    };
  }, [liveListen, isAudioAuthority, subscribeFeatures]);

  useEffect(() => {
    const playback = snapshot?.playback;
    if (!playback) return;

    if (liveListen) {
      const live = liveListenEngine;
      if (!isAudioAuthority || !live) return;
      if (playback.isPlaying) {
        if (live.getStatus() === "paused") void live.start();
      } else if (live.getStatus() === "listening") {
        void live.pause();
      }
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
  }, [snapshot?.playback, isAudioAuthority, sync.clock.offsetMs, liveListen, liveListenEngine]);

  useEffect(() => {
    if (!isAudioAuthority || !onPlaybackAnchor || !snapshot) return;
    const id = window.setInterval(() => {
      const playback = snapshot.playback;
      const now = Date.now();
      if (playback.audioMode === "live_listen") {
        const live = liveListenEngine;
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
  }, [isAudioAuthority, onPlaybackAnchor, snapshot, liveListen, liveListenEngine]);

  if (!snapshot) {
    return (
      <div className={className} role="status">
        <p className="text-prism-mist">Waiting for session snapshot…</p>
      </div>
    );
  }

  const showEnableMic =
    liveListen &&
    isAudioAuthority &&
    !liveListenEngine &&
    (liveStatus === "idle" || liveStatus === "inactive" || liveStatus === "paused");

  return (
    <div className={["flex min-h-0 flex-1 flex-col", className].filter(Boolean).join(" ")}>
      {!ready && !error && !liveListen ? (
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
      {showEnableMic ? (
        <button
          type="button"
          className="prism-btn prism-btn-primary mb-3"
          data-testid="enable-live-listen"
          onClick={() => onStartLiveListen?.()}
        >
          Enable Live Listen
        </button>
      ) : null}
      {liveListen && isAudioAuthority ? (
        <p className="mb-3 text-sm text-prism-mist" data-testid="live-listen-privacy">
          {LIVE_LISTEN_PRIVACY}
        </p>
      ) : null}
      {liveListen && !isAudioAuthority ? (
        <p
          className="mb-3 text-sm text-prism-mist"
          role="status"
          data-testid="live-listen-follower"
        >
          Controller is using Live Listen. This display never asks for a microphone — it follows
          anonymous visualization levels only.
        </p>
      ) : null}
      <VisualizerStageFrame
        label={`${plugin.label} visualizer`}
        immersive={immersive}
        showFullscreen={immersive}
      >
        {liveListen && isAudioAuthority ? (
          <LiveListenStatusPanel
            status={liveStatus}
            errorMessage={liveError}
            onRetry={() => {
              if (liveListenEngine) {
                void liveListenEngine.start();
                return;
              }
              onStartLiveListen?.();
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
        {liveListen && !isAudioAuthority ? (
          <span
            className="sr-only"
            data-testid="remote-feature-energy"
            data-energy={remoteEnergy.toFixed(3)}
            data-feature-source="remote"
          >
            Remote energy {remoteEnergy.toFixed(2)}
          </span>
        ) : null}
      </VisualizerStageFrame>
    </div>
  );
}

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
  LIVE_LISTEN_SOUND_THRESHOLD,
  RemoteFeatureInterpolator,
  type LiveListenEngine,
  type LiveListenEngineStatus,
} from "@prism/audio-engine";
import { VisualizerCanvas, noteDroppedOrStaleFrame } from "@prism/visual-engine";
import { requireVisualizerPlugin } from "@prism/visualizers";
import {
  applyDisplayModeParams,
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
  /** When true, this device owns Demo Track / Live Listen analysis and audio output. */
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

function writeRemoteEnergy(el: HTMLElement | null, energy: number): void {
  if (!el) return;
  el.dataset.energy = energy.toFixed(3);
  el.textContent = `Remote energy ${energy.toFixed(2)}`;
}

function writeMeter(el: HTMLElement | null, energy: number): void {
  if (!el) return;
  const clamped = Math.min(1, Math.max(0, energy));
  el.style.transform = `scaleX(${clamped})`;
  const meter = el.parentElement;
  if (meter) meter.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
}

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
  const frameSeqRef = useRef(0);
  const lastPublishMsRef = useRef(0);
  const lastAnchorRef = useRef(0);
  const lastDemoStatusRef = useRef<string>("idle");
  const lastLiveStatusRef = useRef<LiveListenEngineStatus>("idle");
  const lastHasSoundRef = useRef(false);
  const remoteEnergyElRef = useRef<HTMLSpanElement | null>(null);
  const meterFillRef = useRef<HTMLDivElement | null>(null);
  const publishFeaturesRef = useRef(publishFeatures);
  const isAudioAuthorityRef = useRef(isAudioAuthority);
  const maybePublishRef = useRef((frame: AudioFeatureFrame) => {
    const publish = publishFeaturesRef.current;
    if (!isAudioAuthorityRef.current || !publish) return;
    const now = Date.now();
    if (now - lastPublishMsRef.current < AUDIO_FEATURE_ENVELOPE_INTERVAL_MS) return;
    lastPublishMsRef.current = now;
    frameSeqRef.current += 1;
    publish(audioFeatureFrameToEnvelope(frame, frameSeqRef.current, now));
  });

  const [engineReady, setEngineReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveListenEngineStatus>("idle");
  const [liveError, setLiveError] = useState<string | undefined>();
  const [hasSound, setHasSound] = useState(false);

  useEffect(() => {
    publishFeaturesRef.current = publishFeatures;
    isAudioAuthorityRef.current = isAudioAuthority;
  }, [publishFeatures, isAudioAuthority]);

  const preset: ActivePresetSnapshot | null = snapshot?.preset ?? null;
  const visualizerId: VisualizerId =
    preset?.visualizerId === "dreamscape" ? "spectrum" : (preset?.visualizerId ?? "spectrum");
  const quality: QualityTier = preset?.qualityTier ?? "high";
  const audioMode = snapshot?.playback.audioMode ?? "demo_track";
  const liveListen = audioMode === "live_listen";
  const isPlaying = snapshot?.playback.isPlaying ?? false;
  const sessionId = snapshot?.session.id;
  const ready =
    !isAudioAuthority || engineReady || liveStatus === "listening" || liveStatus === "requesting";
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
    if (!sessionId || liveListen || !isAudioAuthority) {
      engineRef.current = null;
      return;
    }
    const engine = new DemoTrackEngine({ trackUrl: DEMO_TRACK_URL, loop: true });
    engineRef.current = engine;
    lastDemoStatusRef.current = "idle";
    const unsubscribe = engine.subscribe((event) => {
      featuresRef.current = event.frame;
      if (event.status !== lastDemoStatusRef.current) {
        lastDemoStatusRef.current = event.status;
        setEngineReady(
          event.status === "ready" ||
            event.status === "playing" ||
            event.status === "paused" ||
            event.status === "needs_gesture",
        );
        setNeedsGesture(event.status === "needs_gesture");
        if (event.status === "error") setError(event.errorMessage ?? "Audio error");
        if (event.status === "unsupported") setError("Web Audio unsupported");
      }
      if (event.status === "playing") {
        maybePublishRef.current(event.frame);
      }
    });
    void engine.prepare();
    return () => {
      unsubscribe();
      void engine.dispose();
      engineRef.current = null;
    };
  }, [liveListen, sessionId, isAudioAuthority]);

  useEffect(() => {
    if (!sessionId || !liveListen || !isAudioAuthority || !liveListenEngine) return;
    const engine = liveListenEngine;
    lastLiveStatusRef.current = "idle";
    const unsubscribe = engine.subscribe((event) => {
      featuresRef.current = event.frame;
      writeMeter(meterFillRef.current, event.frame.energy);
      const detected = event.frame.energy >= LIVE_LISTEN_SOUND_THRESHOLD;
      if (detected !== lastHasSoundRef.current) {
        lastHasSoundRef.current = detected;
        setHasSound(detected);
      }
      if (event.status !== lastLiveStatusRef.current) {
        lastLiveStatusRef.current = event.status;
        setLiveStatus(event.status);
        setLiveError(event.errorMessage);
        setEngineReady(
          event.status === "listening" ||
            event.status === "paused" ||
            event.status === "requesting",
        );
        setNeedsGesture(event.status === "idle" || event.status === "inactive");
      }
      if (event.status === "listening") {
        maybePublishRef.current(event.frame);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [liveListen, isAudioAuthority, sessionId, liveListenEngine]);

  useEffect(() => {
    const interpolator = interpolatorRef.current;
    if (isAudioAuthority || !subscribeFeatures) {
      interpolator.reset();
      return;
    }
    featuresRef.current = createSilentFeatureFrame();
    const unsubscribe = subscribeFeatures((envelope) => {
      const result = interpolator.ingest(envelope, Date.now());
      if (!result.ok) {
        noteDroppedOrStaleFrame();
        return;
      }
      writeRemoteEnergy(remoteEnergyElRef.current, interpolator.sample(Date.now()).energy);
    });
    return () => {
      unsubscribe();
      interpolator.reset();
    };
  }, [isAudioAuthority, subscribeFeatures]);

  useEffect(() => {
    if (!isAudioAuthority) return;

    if (liveListen) {
      const live = liveListenEngine;
      if (!live) return;
      if (isPlaying) {
        if (live.getStatus() === "paused") void live.start();
      } else if (live.getStatus() === "listening") {
        void live.pause();
      }
      return;
    }

    const engine = engineRef.current;
    if (!engine) return;
    if (isPlaying) void engine.play();
    else void engine.pause();
  }, [isAudioAuthority, isPlaying, liveListen, liveListenEngine]);

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

  const resolveFeatures = !isAudioAuthority
    ? (nowMs: number) => {
        const frame = interpolatorRef.current.sample(nowMs);
        featuresRef.current = frame;
        writeRemoteEnergy(remoteEnergyElRef.current, frame.energy);
        return frame;
      }
    : undefined;

  return (
    <div
      className={["flex min-h-0 flex-1 flex-col", className].filter(Boolean).join(" ")}
      data-testid="session-visualizer-stage"
      data-audio-authority={isAudioAuthority ? "true" : "false"}
      data-audio-output={isAudioAuthority ? "local" : "silent"}
    >
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
      {needsGesture && isAudioAuthority && !liveListen ? (
        <button
          type="button"
          className="prism-btn prism-btn-primary mb-3"
          onClick={() => void engineRef.current?.play()}
        >
          Start Demo Track
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
      {!isAudioAuthority ? (
        <p
          className="mb-3 text-sm text-prism-mist"
          role="status"
          data-testid={liveListen ? "live-listen-follower" : "display-silent"}
        >
          {liveListen
            ? "Controller is using Live Listen. This display never asks for a microphone — it follows anonymous visualization levels only."
            : "This display is silent. Visualization follows the controller; Demo Track audio plays only there."}
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
            hasSound={hasSound}
            meterFillRef={meterFillRef}
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
          resolveFeatures={resolveFeatures}
          quality={quality}
          params={params}
          albumArtUrl={visualizerId === "album_world" ? PLACEHOLDER_ARTWORK_PATH : null}
        />
        {!isAudioAuthority ? (
          <span
            ref={remoteEnergyElRef}
            className="sr-only"
            data-testid="remote-feature-energy"
            data-energy="0.000"
            data-feature-source="remote"
          >
            Remote energy 0.00
          </span>
        ) : null}
      </VisualizerStageFrame>
    </div>
  );
}

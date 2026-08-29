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
  BROWSER_CAPTURE_SOUND_THRESHOLD,
  DemoTrackEngine,
  LIVE_LISTEN_SOUND_THRESHOLD,
  RemoteFeatureInterpolator,
  type BrowserCaptureEngine,
  type BrowserCaptureEngineStatus,
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

import { CaptureMusicStatusPanel } from "@/components/capture-music-status";
import {
  InputDiagnosticsPanel,
  type InputDiagnosticsMetrics,
} from "@/components/input-diagnostics-panel";
import { VisualizerStageFrame } from "@/components/visualizer-stage-frame";
import { PLACEHOLDER_ARTWORK_PATH } from "@/lib/local-artwork";
import type { CaptureInputOption } from "@/components/audio-mode-selector";

const DEMO_TRACK_URL = "/audio/demo-track.wav";
const CAPTURE_PRIVACY =
  "Audio analysis stays on this device. Prism shares only anonymous visualization levels with your paired display—never your audio or screen.";

export type CaptureEngine = BrowserCaptureEngine | LiveListenEngine;
export type CaptureEngineStatus = BrowserCaptureEngineStatus | LiveListenEngineStatus;

type SessionVisualizerStageProps = {
  sync: SyncEngineState;
  /**
   * When true, this device owns Demo Track / Capture Music analysis and (for Demo Track) audio output.
   * Must stay false for display-only devices and while the local role is unresolved.
   */
  isAudioAuthority: boolean;
  onPlaybackAnchor?: (playback: PlaybackState) => void;
  className?: string;
  immersive?: boolean;
  /** Controller-owned engine started from a user gesture. Displays must omit this. */
  captureEngine?: CaptureEngine | null;
  captureSource?: CaptureInputOption;
  subscribeFeatures?: (listener: (envelope: AudioFeatureEnvelope) => void) => () => void;
  publishFeatures?: (envelope: AudioFeatureEnvelope) => void;
  onStartCapture?: () => void;
  onStopCapture?: () => void;
  onUseMicrophone?: () => void;
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

function isCaptureActiveStatus(status: CaptureEngineStatus): boolean {
  return status === "listening" || status === "waiting" || status === "requesting";
}

export function SessionVisualizerStage({
  sync,
  isAudioAuthority,
  onPlaybackAnchor,
  className,
  immersive = false,
  captureEngine = null,
  captureSource = "browser_capture",
  subscribeFeatures,
  publishFeatures,
  onStartCapture,
  onStopCapture,
  onUseMicrophone,
}: SessionVisualizerStageProps) {
  const snapshot = sync.snapshot;
  const roleResolved = sync.localRole !== null;
  const canOwnAudio = isAudioAuthority === true && roleResolved && sync.localRole !== "display";
  const engineRef = useRef<DemoTrackEngine | null>(null);
  const featuresRef = useRef<AudioFeatureFrame>(createSilentFeatureFrame());
  const interpolatorRef = useRef(new RemoteFeatureInterpolator());
  // The server rejects feature sequences lower than the last one seen for the
  // session. Seed from wall-clock time so a controller reload/reconnect cannot
  // restart at 1 and have every otherwise-valid envelope rejected.
  const frameSeqRef = useRef(0);
  const lastPublishMsRef = useRef(0);
  const lastAnchorRef = useRef(0);
  const lastDemoStatusRef = useRef<string>("idle");
  const lastCaptureStatusRef = useRef<CaptureEngineStatus>("idle");
  const lastHasSoundRef = useRef(false);
  const remoteEnergyElRef = useRef<HTMLSpanElement | null>(null);
  const meterFillRef = useRef<HTMLDivElement | null>(null);
  const publishFeaturesRef = useRef(publishFeatures);
  const canOwnAudioRef = useRef(canOwnAudio);
  const publishCountRef = useRef(0);
  const publishWindowStartRef = useRef(0);
  const [diagnosticMetrics, setDiagnosticMetrics] = useState<InputDiagnosticsMetrics>({
    inputMode: captureSource,
    capturePermissionResult: "idle",
    realtimeConnectionStatus: sync.connection,
    envelopesPublishedPerSecond: 0,
  });

  useEffect(() => {
    frameSeqRef.current = Date.now() * 1000;
    // maybePublishRef uses Date.now(); keep diagnostics on the same clock.
    publishWindowStartRef.current = Date.now();
  }, []);
  const maybePublishRef = useRef((frame: AudioFeatureFrame) => {
    const publish = publishFeaturesRef.current;
    if (!canOwnAudioRef.current || !publish) return;
    const now = Date.now();
    if (now - lastPublishMsRef.current < AUDIO_FEATURE_ENVELOPE_INTERVAL_MS) return;
    lastPublishMsRef.current = now;
    frameSeqRef.current += 1;
    publish(audioFeatureFrameToEnvelope(frame, frameSeqRef.current, now));
    publishCountRef.current += 1;
    const windowStart = publishWindowStartRef.current || now;
    const elapsed = Math.max(1, now - windowStart);
    if (elapsed >= 1000) {
      setDiagnosticMetrics((current) => ({
        ...current,
        envelopesPublishedPerSecond: (publishCountRef.current * 1000) / elapsed,
      }));
      publishCountRef.current = 0;
      publishWindowStartRef.current = now;
    }
  });

  const [engineReady, setEngineReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureEngineStatus>("idle");
  const [captureError, setCaptureError] = useState<string | undefined>();
  const [hasSound, setHasSound] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);

  useEffect(() => {
    publishFeaturesRef.current = publishFeatures;
    canOwnAudioRef.current = canOwnAudio;
  }, [publishFeatures, canOwnAudio]);

  const liveDiagnosticMetrics = useMemo<InputDiagnosticsMetrics>(
    () => ({
      ...diagnosticMetrics,
      inputMode: captureSource,
      realtimeConnectionStatus: sync.connection,
    }),
    [captureSource, diagnosticMetrics, sync.connection],
  );

  const preset: ActivePresetSnapshot | null = snapshot?.preset ?? null;
  const visualizerId: VisualizerId =
    preset?.visualizerId === "dreamscape" ? "spectrum" : (preset?.visualizerId ?? "spectrum");
  const quality: QualityTier = preset?.qualityTier ?? "high";
  const audioMode = snapshot?.playback.audioMode ?? "demo_track";
  const captureMode = audioMode === "live_listen";
  const isPlaying = snapshot?.playback.isPlaying ?? false;
  const sessionId = snapshot?.session.id;
  const ready = !canOwnAudio || engineReady || isCaptureActiveStatus(captureStatus);
  const deviceIndex = snapshot ? displayDeviceIndex(snapshot.devices, sync.localDeviceId ?? "") : 0;
  const params = useMemo(() => {
    const base = parseVisualizerParams(
      visualizerId,
      preset?.params ?? defaultParamsForVisualizer(visualizerId),
    );
    return applyDisplayModeParams(base, snapshot?.session.displayMode ?? "mirror", deviceIndex);
  }, [visualizerId, preset?.params, snapshot?.session.displayMode, deviceIndex]);

  const plugin = useMemo(() => requireVisualizerPlugin(visualizerId), [visualizerId]);
  const micMode = captureSource === "microphone";
  const soundThreshold = micMode ? LIVE_LISTEN_SOUND_THRESHOLD : BROWSER_CAPTURE_SOUND_THRESHOLD;

  useEffect(() => {
    // Display-only / unresolved role: never construct Demo Track (no audio output graph).
    if (!sessionId || captureMode || !canOwnAudio) {
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
  }, [captureMode, sessionId, canOwnAudio]);

  useEffect(() => {
    if (!sessionId || !captureMode || !canOwnAudio || !captureEngine) return;
    const engine = captureEngine;
    lastCaptureStatusRef.current = "idle";
    const unsubscribe = engine.subscribe((event) => {
      featuresRef.current = event.frame;
      writeMeter(meterFillRef.current, event.frame.energy);
      setInputLevel(event.frame.energy);
      const detected = event.frame.energy >= soundThreshold;
      if (detected !== lastHasSoundRef.current) {
        lastHasSoundRef.current = detected;
        setHasSound(detected);
      }
      if (event.status !== lastCaptureStatusRef.current) {
        lastCaptureStatusRef.current = event.status;
        setCaptureStatus(event.status);
        setCaptureError(event.errorMessage);
        setDiagnosticMetrics((current) => ({
          ...current,
          capturePermissionResult: event.status,
          lastErrorCategory: event.errorMessage ?? null,
        }));
        setEngineReady(isCaptureActiveStatus(event.status) || event.status === "paused");
        setNeedsGesture(
          event.status === "idle" ||
            event.status === "inactive" ||
            event.status === "ended" ||
            event.status === "no_audio",
        );
      }
      if (event.status === "listening" || event.status === "waiting") {
        maybePublishRef.current(event.frame);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [captureMode, canOwnAudio, sessionId, captureEngine, soundThreshold]);

  useEffect(() => {
    const interpolator = interpolatorRef.current;
    if (canOwnAudio || !subscribeFeatures) {
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
  }, [canOwnAudio, subscribeFeatures]);

  useEffect(() => {
    if (!canOwnAudio) return;

    if (captureMode) {
      const live = captureEngine;
      if (!live) return;
      if (isPlaying) {
        if (live.getStatus() === "paused") void live.start();
      } else if (live.getStatus() === "listening" || live.getStatus() === "waiting") {
        void live.pause();
      }
      return;
    }

    const engine = engineRef.current;
    if (!engine) return;
    if (isPlaying) void engine.play();
    else void engine.pause();
  }, [canOwnAudio, isPlaying, captureMode, captureEngine]);

  useEffect(() => {
    if (!canOwnAudio || !onPlaybackAnchor || !snapshot) return;
    const id = window.setInterval(() => {
      const playback = snapshot.playback;
      const now = Date.now();
      if (playback.audioMode === "live_listen") {
        const live = captureEngine;
        if (!live) return;
        const status = live.getStatus();
        const active = status === "listening" || status === "waiting";
        if (now - lastAnchorRef.current < 1800 && active) return;
        lastAnchorRef.current = now;
        onPlaybackAnchor({
          audioMode: "live_listen",
          isPlaying: active,
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
  }, [canOwnAudio, onPlaybackAnchor, snapshot, captureMode, captureEngine]);

  if (!snapshot) {
    return (
      <div className={className} role="status">
        <p className="text-prism-mist">Waiting for session snapshot…</p>
      </div>
    );
  }

  const showEnableCapture =
    captureMode &&
    canOwnAudio &&
    !captureEngine &&
    (captureStatus === "idle" ||
      captureStatus === "inactive" ||
      captureStatus === "paused" ||
      captureStatus === "ended");

  const resolveFeatures = !canOwnAudio
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
      data-audio-authority={canOwnAudio ? "true" : "false"}
      data-audio-output={canOwnAudio && !captureMode ? "local" : "silent"}
      data-role-resolved={roleResolved ? "true" : "false"}
    >
      {!ready && !error && !captureMode ? (
        <p className="mb-3 text-sm text-prism-mist" role="status">
          Loading visualizer…
        </p>
      ) : null}
      {error ? (
        <p className="mb-3 text-sm text-prism-ember" role="alert">
          {error}
        </p>
      ) : null}
      {needsGesture && canOwnAudio && !captureMode ? (
        <button
          type="button"
          className="prism-btn prism-btn-primary mb-3"
          onClick={() => void engineRef.current?.play()}
        >
          Start Demo Track
        </button>
      ) : null}
      {showEnableCapture ? (
        <button
          type="button"
          className="prism-btn prism-btn-primary mb-3"
          data-testid="enable-capture-music"
          onClick={() => onStartCapture?.()}
        >
          {micMode ? "Enable Microphone" : "Start Capture Music"}
        </button>
      ) : null}
      {captureMode && canOwnAudio ? (
        <p className="mb-3 text-sm text-prism-mist" data-testid="capture-music-privacy">
          {CAPTURE_PRIVACY}
        </p>
      ) : null}
      {!canOwnAudio ? (
        <p
          className="mb-3 text-sm text-prism-mist"
          role="status"
          data-testid={captureMode ? "capture-music-follower" : "display-silent"}
        >
          {captureMode
            ? "Controller is using Capture Music. This display never asks for microphone or screen capture — it follows anonymous visualization levels only."
            : "This display is silent. Visualization follows the controller; Demo Track audio plays only there."}
        </p>
      ) : null}
      <VisualizerStageFrame
        label={`${plugin.label} visualizer`}
        immersive={immersive}
        showFullscreen={immersive}
      >
        {captureMode && canOwnAudio ? (
          <CaptureMusicStatusPanel
            status={captureStatus}
            source={micMode ? "microphone" : "browser"}
            errorMessage={captureError}
            hasSound={hasSound}
            inputLevel={inputLevel}
            meterFillRef={meterFillRef}
            onRetry={() => {
              if (captureEngine) {
                void captureEngine.start();
                return;
              }
              onStartCapture?.();
            }}
            onStop={() => {
              onStopCapture?.();
            }}
            onUseMicrophone={
              !micMode
                ? () => {
                    onUseMicrophone?.();
                  }
                : undefined
            }
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
        {!canOwnAudio ? (
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
      {captureMode && canOwnAudio ? (
        <InputDiagnosticsPanel
          engine={captureEngine ?? null}
          metrics={liveDiagnosticMetrics}
          publishFeatures={publishFeatures}
        />
      ) : null}
    </div>
  );
}

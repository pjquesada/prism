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
import { DemoTrackEngine } from "@prism/audio-engine";
import { VisualizerCanvas } from "@prism/visual-engine";
import { requireVisualizerPlugin } from "@prism/visualizers";
import {
  applyDisplayModeParams,
  correctPlaybackDrift,
  displayDeviceIndex,
  type SyncEngineState,
} from "@prism/sync-engine";

import { PLACEHOLDER_ARTWORK_PATH } from "@/lib/local-artwork";

const DEMO_TRACK_URL = "/audio/demo-track.wav";

type SessionVisualizerStageProps = {
  sync: SyncEngineState;
  /** When true, this device owns Demo Track transport and publishes anchors externally. */
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
  const featuresRef = useRef<AudioFeatureFrame>(createSilentFeatureFrame());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const lastAnchorRef = useRef(0);

  const preset: ActivePresetSnapshot | null = snapshot?.preset ?? null;
  const visualizerId: VisualizerId =
    preset?.visualizerId === "dreamscape" ? "spectrum" : (preset?.visualizerId ?? "spectrum");
  const quality: QualityTier = preset?.qualityTier ?? "high";
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
    const engine = new DemoTrackEngine({ trackUrl: DEMO_TRACK_URL, loop: true });
    engineRef.current = engine;
    const unsubscribe = engine.subscribe((event) => {
      featuresRef.current = event.frame;
      setReady(
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
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    const playback = snapshot?.playback;
    if (!engine || !playback) return;

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
  }, [snapshot?.playback, isAudioAuthority, sync.clock.offsetMs]);

  useEffect(() => {
    if (!isAudioAuthority || !onPlaybackAnchor || !snapshot) return;
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const status = engine.getStatus();
      const now = Date.now();
      if (now - lastAnchorRef.current < 1800 && status === "playing") return;
      lastAnchorRef.current = now;
      onPlaybackAnchor({
        audioMode: "demo_track",
        isPlaying: status === "playing",
        positionMs: engine.getPositionMs(),
        rate: engine.getPlaybackRate(),
        trackId: "demo-track",
        updatedAt: new Date().toISOString(),
        seq: snapshot.playback.seq,
      });
    }, 2000);
    return () => window.clearInterval(id);
  }, [isAudioAuthority, onPlaybackAnchor, snapshot]);

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
      {needsGesture ? (
        <button
          type="button"
          className="prism-btn prism-btn-primary mb-3"
          onClick={() => void engineRef.current?.play()}
        >
          Enable audio on this display
        </button>
      ) : null}
      <div className="relative min-h-[min(70vh,36rem)] overflow-hidden rounded-sm border border-prism-slate bg-prism-deep/70">
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

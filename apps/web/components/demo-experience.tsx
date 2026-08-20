"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  DemoTrackEngine,
  LiveListenEngine,
  LIVE_LISTEN_SOUND_THRESHOLD,
  getResourceCounts,
  silentFrame,
  type DemoTrackEngineStatus,
  type LiveListenEngineStatus,
} from "@prism/audio-engine";
import {
  createBuiltInPresets,
  defaultParamsForVisualizer,
  parseVisualizerParams,
  type AudioFeatureFrame,
  type AudioMode,
  type PresetConfig,
  type QualityTier,
  type VisualizerId,
} from "@prism/contracts";
import { VisualizerCanvas, registerPerfResourceSource } from "@prism/visual-engine";
import { requireVisualizerPlugin } from "@prism/visualizers";

import { AudioModeSelector } from "@/components/audio-mode-selector";
import { LiveListenStatusPanel } from "@/components/live-listen-status";
import { VisualizerSelector } from "@/components/visualizer-selector";
import { VisualizerStageFrame } from "@/components/visualizer-stage-frame";
import {
  createBlankPreset,
  duplicatePreset,
  listMergedPresets,
  resetPresetParams,
  updatePresetParams,
} from "@/lib/guest-presets";
import {
  PLACEHOLDER_ARTWORK_PATH,
  createEmptyArtworkState,
  readLocalArtworkFile,
  revokeArtworkUrl,
  type LocalArtworkState,
} from "@/lib/local-artwork";
import { useGuestPresetStore } from "@/lib/use-guest-preset-store";
import { isLiveListenEnabled } from "@/lib/live-listen-enabled";

registerPerfResourceSource(getResourceCounts);

const DEMO_TRACK_URL = "/audio/demo-track.wav";
const DEMO_TRACK_TITLE = "Prism Demo Loop";
const DEMO_TRACK_DESCRIPTION =
  "Original synthetic royalty-free loop generated for Prism (16s, ~96 BPM).";

const QUALITY_OPTIONS: { id: QualityTier | "auto"; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "ultra", label: "Ultra" },
];

export type DemoExperienceVariant = "demo" | "combined";

type DemoExperienceProps = {
  variant: DemoExperienceVariant;
  quality?: QualityTier;
  initialVisualizerId?: VisualizerId;
  initialPresetId?: string;
};

function statusLabel(
  audioMode: AudioMode,
  demoStatus: DemoTrackEngineStatus,
  liveStatus: LiveListenEngineStatus,
): string {
  if (audioMode === "live_listen") {
    switch (liveStatus) {
      case "requesting":
        return "Waiting for microphone permission…";
      case "listening":
        return "Live Listen — local microphone analysis only";
      case "paused":
        return "Live Listen paused";
      case "denied":
        return "Microphone permission denied";
      case "unavailable":
        return "No microphone found";
      case "unsupported":
        return "Microphone is not available in this browser";
      case "inactive":
        return "Audio context is inactive — tap Live Listen again";
      case "error":
        return "Live Listen error";
      case "idle":
      default:
        return "Live Listen idle";
    }
  }
  switch (demoStatus) {
    case "loading":
      return "Loading Demo Track…";
    case "needs_gesture":
      return "Press Play to start (browser autoplay is blocked until you interact).";
    case "ready":
      return "Ready — press Play.";
    case "playing":
      return "Playing Demo Track";
    case "paused":
      return "Paused";
    case "unsupported":
      return "Web Audio is not supported in this browser.";
    case "error":
      return "Audio error";
    case "idle":
    default:
      return "Idle";
  }
}

export function DemoExperience({
  variant,
  quality = "high",
  initialVisualizerId = "spectrum",
  initialPresetId,
}: DemoExperienceProps) {
  const liveListenEnabled = isLiveListenEnabled();
  const engineRef = useRef<DemoTrackEngine | null>(null);
  const liveEngineRef = useRef<LiveListenEngine | null>(null);
  const featuresRef = useRef<AudioFeatureFrame>(silentFrame());
  const [audioMode, setAudioMode] = useState<AudioMode>("demo_track");
  const [status, setStatus] = useState<DemoTrackEngineStatus>("idle");
  const [liveStatus, setLiveStatus] = useState<LiveListenEngineStatus>("idle");
  const lastLiveStatusRef = useRef<LiveListenEngineStatus>("idle");
  const lastDemoStatusRef = useRef<DemoTrackEngineStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [hud, setHud] = useState({ energy: 0, onset: false, bass: 0, mid: 0, high: 0 });
  const [qualityMode, setQualityMode] = useState<QualityTier | "auto">("auto");
  const [effectiveQuality, setEffectiveQuality] = useState<QualityTier>(quality);
  const { users: userPresets, error: storeError, replaceUsers } = useGuestPresetStore();
  const [artwork, setArtwork] = useState<LocalArtworkState>(createEmptyArtworkState);
  const [visualizerId, setVisualizerId] = useState<VisualizerId>(
    initialVisualizerId === "dreamscape" ? "spectrum" : initialVisualizerId,
  );
  const [activePresetId, setActivePresetId] = useState<string>(
    initialPresetId ?? "builtin-spectrum-calm",
  );
  const [draftParams, setDraftParams] = useState<Record<string, unknown>>(() =>
    defaultParamsForVisualizer(
      initialVisualizerId === "dreamscape" ? "spectrum" : initialVisualizerId,
    ),
  );
  const [presetName, setPresetName] = useState("My preset");
  const appliedInitialPreset = useRef(false);

  const plugin = useMemo(() => requireVisualizerPlugin(visualizerId), [visualizerId]);
  const mergedPresets = useMemo(() => listMergedPresets(userPresets), [userPresets]);
  const activePreset = mergedPresets.find((p) => p.id === activePresetId) ?? mergedPresets[0];

  // Apply deep-linked preset once client snapshot is available (after hydration).
  useEffect(() => {
    if (appliedInitialPreset.current) return;
    if (!initialPresetId) {
      appliedInitialPreset.current = true;
      return;
    }
    const found = listMergedPresets(userPresets).find((preset) => preset.id === initialPresetId);
    if (!found) return;
    appliedInitialPreset.current = true;
    const id = found.visualizerId === "dreamscape" ? "spectrum" : found.visualizerId;
    startTransition(() => {
      setActivePresetId(found.id);
      setVisualizerId(id);
      setDraftParams(parseVisualizerParams(id, found.params));
      setPresetName(found.isBuiltIn ? `${found.name} Edit` : found.name);
    });
  }, [initialPresetId, userPresets]);

  useEffect(() => {
    if (audioMode !== "demo_track") {
      engineRef.current = null;
      return;
    }
    const engine = new DemoTrackEngine({ trackUrl: DEMO_TRACK_URL, loop: true });
    engineRef.current = engine;
    let lastHud = 0;
    const unsubscribe = engine.subscribe((event) => {
      featuresRef.current = event.frame;
      if (event.status !== lastDemoStatusRef.current) {
        lastDemoStatusRef.current = event.status;
        setStatus(event.status);
        setErrorMessage(event.errorMessage);
      }
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      if (now - lastHud > 200) {
        lastHud = now;
        setHud({
          energy: event.frame.energy,
          onset: event.frame.onset,
          bass: event.frame.bass,
          mid: event.frame.mid,
          high: event.frame.high,
        });
      }
    });
    void engine.prepare();

    return () => {
      unsubscribe();
      void engine.dispose();
      engineRef.current = null;
    };
  }, [audioMode]);

  useEffect(() => {
    return () => {
      void liveEngineRef.current?.dispose();
      liveEngineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (audioMode !== "live_listen") {
      const existing = liveEngineRef.current;
      liveEngineRef.current = null;
      if (existing) void existing.dispose();
      return;
    }
    const engine = liveEngineRef.current;
    if (!engine) return;
    lastLiveStatusRef.current = "idle";
    let lastHud = 0;
    const unsubscribe = engine.subscribe((event) => {
      featuresRef.current = event.frame;
      if (event.status !== lastLiveStatusRef.current) {
        lastLiveStatusRef.current = event.status;
        setLiveStatus(event.status);
        setErrorMessage(event.errorMessage);
      }
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      if (now - lastHud > 200) {
        lastHud = now;
        setHud({
          energy: event.frame.energy,
          onset: event.frame.onset,
          bass: event.frame.bass,
          mid: event.frame.mid,
          high: event.frame.high,
        });
      }
    });
    return () => {
      unsubscribe();
    };
  }, [audioMode]);

  useEffect(() => {
    return () => {
      revokeArtworkUrl(artwork.objectUrl);
    };
  }, [artwork.objectUrl]);

  const persistUsers = (next: PresetConfig[]) => {
    replaceUsers(next);
  };

  const applyPreset = (preset: PresetConfig) => {
    const id = preset.visualizerId === "dreamscape" ? "spectrum" : preset.visualizerId;
    setActivePresetId(preset.id);
    setVisualizerId(id);
    setDraftParams(parseVisualizerParams(id, preset.params));
    setPresetName(preset.isBuiltIn ? `${preset.name} Edit` : preset.name);
  };

  const busy = audioMode === "demo_track" ? status === "loading" : liveStatus === "requesting";
  const canPlay =
    audioMode === "live_listen"
      ? liveStatus === "paused" || liveStatus === "idle"
      : status === "ready" || status === "needs_gesture" || status === "paused";
  const canPause = audioMode === "live_listen" ? liveStatus === "listening" : status === "playing";
  const showUnsupported =
    audioMode === "demo_track" ? status === "unsupported" : liveStatus === "unsupported";
  const showError = audioMode === "demo_track" ? status === "error" : false;
  const albumArtUrl =
    visualizerId === "album_world"
      ? artwork.status === "ready"
        ? artwork.objectUrl
        : PLACEHOLDER_ARTWORK_PATH
      : null;

  const canvasQuality = qualityMode === "auto" ? quality : qualityMode;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.14em] text-prism-aurora">
            {variant === "combined"
              ? `Combined · ${audioMode === "live_listen" ? "Live Listen" : "Demo Track"}`
              : audioMode === "live_listen"
                ? "Live Listen"
                : "Demo Track"}
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-prism-foam sm:text-5xl">
            {plugin.label}
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-prism-mist">
            Local analysis only — numeric feature frames stay on this device.{" "}
            <span className="text-prism-foam">{DEMO_TRACK_TITLE}</span>: {DEMO_TRACK_DESCRIPTION}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="prism-btn prism-btn-primary"
            disabled={busy || showUnsupported || (!canPlay && !canPause && status !== "idle")}
            onClick={() => {
              if (audioMode === "live_listen") {
                if (canPause) {
                  void liveEngineRef.current?.pause();
                  return;
                }
                void liveEngineRef.current?.start();
                return;
              }
              if (canPause) {
                void engineRef.current?.pause();
                return;
              }
              void engineRef.current?.play();
            }}
          >
            {canPause ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="prism-btn prism-btn-ghost"
            onClick={() => {
              const el = document.querySelector<HTMLElement>(`[data-visualizer='${plugin.id}']`);
              if (!el) return;
              if (document.fullscreenElement) {
                void document.exitFullscreen();
              } else {
                void el.requestFullscreen?.();
              }
            }}
          >
            Full screen
          </button>
          <Link href="/presets" className="prism-btn prism-btn-ghost">
            Presets
          </Link>
        </div>
      </div>

      <AudioModeSelector
        value={audioMode}
        allowLiveListen={liveListenEnabled}
        onSelect={(mode) => {
          setErrorMessage(undefined);
          if (mode === "live_listen") {
            if (!liveEngineRef.current) {
              liveEngineRef.current = new LiveListenEngine();
            }
            void liveEngineRef.current.start();
          }
          setAudioMode(mode);
        }}
      />

      <VisualizerSelector
        value={visualizerId}
        onSelect={(id) => {
          setVisualizerId(id);
          const match = mergedPresets.find((p) => p.visualizerId === id && p.isBuiltIn);
          if (match) {
            applyPreset(match);
          } else {
            setDraftParams(defaultParamsForVisualizer(id));
            setActivePresetId(`draft-${id}`);
          }
        }}
      />

      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Quality">
        <span className="text-sm text-prism-mist">Quality</span>
        {QUALITY_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={
              option.id === qualityMode
                ? "prism-btn prism-btn-primary"
                : "prism-btn prism-btn-ghost"
            }
            aria-pressed={option.id === qualityMode}
            onClick={() => {
              setQualityMode(option.id);
              if (option.id !== "auto") setEffectiveQuality(option.id);
            }}
          >
            {option.label}
          </button>
        ))}
        <span className="text-xs text-prism-mist/80">Effective: {effectiveQuality}</span>
      </div>

      {audioMode === "live_listen" ? (
        <p className="text-sm text-prism-mist" data-testid="live-listen-privacy">
          Microphone audio stays on this device. Only anonymous visualization levels are shared with
          your paired display.
        </p>
      ) : null}

      <div
        className="relative flex min-h-[50dvh] flex-1 flex-col overflow-hidden"
        role="region"
        aria-label={`${plugin.label} visualizer`}
      >
        {busy ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-prism-ink/50"
            role="status"
          >
            <p className="text-prism-foam">
              {audioMode === "live_listen"
                ? "Waiting for microphone permission…"
                : "Loading Demo Track…"}
            </p>
          </div>
        ) : null}

        {showUnsupported && audioMode === "demo_track" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6" role="alert">
            <p className="max-w-md text-center text-prism-foam">
              This browser does not support the Web Audio API required for Demo Track analysis.
            </p>
          </div>
        ) : null}

        {showError ? (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 p-6"
            role="alert"
          >
            <p className="max-w-md text-center text-prism-foam">
              {errorMessage ?? "Demo Track could not be played."}
            </p>
            <button
              type="button"
              className="prism-btn prism-btn-primary"
              onClick={() => {
                void engineRef.current?.prepare().then(() => engineRef.current?.play());
              }}
            >
              Retry
            </button>
          </div>
        ) : null}

        {audioMode === "live_listen" ? (
          <LiveListenStatusPanel
            status={liveStatus}
            errorMessage={errorMessage}
            hasSound={hud.energy >= LIVE_LISTEN_SOUND_THRESHOLD}
            inputLevel={hud.energy}
            onRetry={() => {
              void liveEngineRef.current?.start();
            }}
            onUseDemoTrack={() => {
              setAudioMode("demo_track");
            }}
          />
        ) : null}

        <VisualizerStageFrame
          label={`${plugin.label} visualizer`}
          immersive={false}
          showFullscreen
          className="min-h-[50dvh]"
        >
          <VisualizerCanvas
            plugin={plugin}
            featuresRef={featuresRef}
            quality={canvasQuality}
            adaptiveQuality={qualityMode === "auto"}
            params={draftParams}
            albumArtUrl={albumArtUrl}
            onQualityChange={setEffectiveQuality}
            fallback={
              <div className="flex h-full items-center justify-center p-6">
                <p className="max-w-md text-center text-prism-foam">
                  WebGL is unavailable. Audio can still play, but visualizers cannot render.
                </p>
              </div>
            }
          />
        </VisualizerStageFrame>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-display text-lg text-prism-foam">Preset</h2>
          <label className="block text-sm text-prism-mist">
            Active preset
            <select
              className="mt-1 w-full rounded-sm border border-prism-slate bg-prism-ink px-3 py-2 text-prism-foam"
              value={activePreset?.id ?? ""}
              onChange={(event) => {
                const next = mergedPresets.find((p) => p.id === event.target.value);
                if (next) applyPreset(next);
              }}
            >
              {mergedPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                  {preset.isBuiltIn ? " (built-in)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-prism-mist">
            Name
            <input
              className="mt-1 w-full rounded-sm border border-prism-slate bg-prism-ink px-3 py-2 text-prism-foam"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="prism-btn prism-btn-ghost"
              onClick={() => {
                const source =
                  activePreset ?? createBlankPreset(visualizerId, presetName || "Untitled");
                const copy = duplicatePreset(
                  {
                    ...source,
                    params: draftParams,
                    visualizerId,
                  },
                  presetName || undefined,
                );
                persistUsers([...userPresets, copy]);
                applyPreset(copy);
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="prism-btn prism-btn-ghost"
              onClick={() => {
                const base =
                  activePreset && !activePreset.isBuiltIn
                    ? activePreset
                    : createBlankPreset(visualizerId, presetName || "Untitled");
                const saved = updatePresetParams(
                  { ...base, name: presetName || base.name, visualizerId },
                  draftParams,
                );
                const without = userPresets.filter((p) => p.id !== saved.id);
                persistUsers([...without, saved]);
                applyPreset(saved);
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="prism-btn prism-btn-ghost"
              onClick={() => {
                const source =
                  activePreset ?? createBlankPreset(visualizerId, presetName || "Untitled");
                const reset = resetPresetParams({ ...source, visualizerId, isBuiltIn: false });
                setDraftParams(reset.params);
              }}
            >
              Reset
            </button>
            <button
              type="button"
              className="prism-btn prism-btn-ghost"
              disabled={!activePreset || activePreset.isBuiltIn}
              onClick={() => {
                if (!activePreset || activePreset.isBuiltIn) return;
                const next = userPresets.filter((p) => p.id !== activePreset.id);
                persistUsers(next);
                const fallback = createBuiltInPresets().find(
                  (p) => p.visualizerId === visualizerId,
                );
                if (fallback) applyPreset(fallback);
              }}
            >
              Delete
            </button>
          </div>
          {storeError ? (
            <p className="text-sm text-prism-ember" role="alert">
              {storeError}
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <h2 className="font-display text-lg text-prism-foam">Live params</h2>
          <label className="block text-sm text-prism-mist">
            Sensitivity
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.05}
              className="mt-1 w-full"
              value={Number(draftParams.sensitivity ?? 1)}
              onChange={(event) => {
                setDraftParams((prev) => ({
                  ...prev,
                  sensitivity: Number(event.target.value),
                }));
              }}
            />
          </label>
          {visualizerId === "album_world" ? (
            <div className="space-y-2">
              <p className="text-sm text-prism-mist">
                Local artwork only — never uploaded. Missing or invalid files use Prism placeholder
                art.
              </p>
              <input
                type="file"
                accept="image/*"
                aria-label="Choose local artwork"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  void (async () => {
                    const previous = artwork.objectUrl;
                    const next = await readLocalArtworkFile(file);
                    setArtwork(next);
                    revokeArtworkUrl(previous);
                  })();
                }}
              />
              {artwork.status === "error" ? (
                <p className="text-sm text-prism-ember" role="alert">
                  {artwork.error}
                </p>
              ) : null}
              <button
                type="button"
                className="prism-btn prism-btn-ghost"
                onClick={() => {
                  revokeArtworkUrl(artwork.objectUrl);
                  setArtwork(createEmptyArtworkState());
                }}
              >
                Clear artwork
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-2" aria-live="polite">
        <p className="text-sm text-prism-mist">{statusLabel(audioMode, status, liveStatus)}</p>
        {errorMessage && status === "needs_gesture" ? (
          <p className="text-sm text-prism-ember">{errorMessage}</p>
        ) : null}
        <p className="text-xs text-prism-mist/80">
          Energy {hud.energy.toFixed(2)} · bass {hud.bass.toFixed(2)} · mid {hud.mid.toFixed(2)} ·
          high {hud.high.toFixed(2)} · onset {hud.onset ? "yes" : "no"}
        </p>
      </div>
    </div>
  );
}

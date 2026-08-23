"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserCaptureEngine,
  BROWSER_CAPTURE_SOUND_THRESHOLD,
  DemoTrackEngine,
  LiveListenEngine,
  LIVE_LISTEN_SOUND_THRESHOLD,
  getResourceCounts,
  silentFrame,
  type BrowserCaptureEngineStatus,
  type DemoTrackEngineStatus,
  type LiveListenEngineStatus,
} from "@prism/audio-engine";
import {
  createBuiltInPresets,
  defaultParamsForVisualizer,
  parseVisualizerParams,
  type AudioFeatureFrame,
  type PresetConfig,
  type QualityTier,
  type VisualizerId,
} from "@prism/contracts";
import { VisualizerCanvas, registerPerfResourceSource } from "@prism/visual-engine";
import { requireVisualizerPlugin } from "@prism/visualizers";

import {
  AudioModeSelector,
  type CaptureInputOption,
} from "@/components/audio-mode-selector";
import { CaptureCompatibilityNote } from "@/components/capture-compatibility-note";
import { CaptureMusicStatusPanel } from "@/components/capture-music-status";
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
import { writeCaptureInputPreference } from "@/lib/capture-input";

registerPerfResourceSource(getResourceCounts);

const DEMO_TRACK_URL = "/audio/demo-track.wav";
const DEMO_TRACK_TITLE = "Prism Demo Loop";
const DEMO_TRACK_DESCRIPTION =
  "Original synthetic royalty-free loop generated for Prism (16s, ~96 BPM).";
const CAPTURE_PRIVACY =
  "Audio analysis stays on this device. Prism shares only anonymous visualization levels with your paired display—never your audio or screen.";

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

type CaptureStatus = BrowserCaptureEngineStatus | LiveListenEngineStatus;

function statusLabel(
  input: CaptureInputOption,
  demoStatus: DemoTrackEngineStatus,
  captureStatus: CaptureStatus,
): string {
  if (input === "browser_capture") {
    switch (captureStatus) {
      case "requesting":
        return "Requesting browser permission…";
      case "waiting":
        return "Connected — waiting for audio";
      case "listening":
        return "Connected — music detected";
      case "paused":
        return "Capture Music paused";
      case "no_audio":
        return "Shared source has no audio";
      case "ended":
        return "Sharing stopped";
      case "denied":
        return "Capture blocked or denied";
      case "unsupported":
        return "Browser/system audio unsupported";
      case "inactive":
        return "Audio context suspended";
      case "error":
        return "Capture Music error";
      case "idle":
      default:
        return "Choose music source";
    }
  }
  if (input === "microphone") {
    switch (captureStatus) {
      case "requesting":
        return "Waiting for microphone permission…";
      case "listening":
      case "waiting":
        return "Microphone — local analysis only";
      case "paused":
        return "Microphone paused";
      case "denied":
        return "Microphone permission denied";
      case "unavailable":
        return "No microphone found";
      case "unsupported":
        return "Microphone is not available in this browser";
      case "inactive":
        return "Audio context is inactive — tap Microphone again";
      case "error":
        return "Microphone error";
      case "idle":
      default:
        return "Microphone idle";
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

function inputTitle(input: CaptureInputOption): string {
  switch (input) {
    case "browser_capture":
      return "Capture Music";
    case "microphone":
      return "Microphone";
    default:
      return "Demo Track";
  }
}

export function DemoExperience({
  variant,
  quality = "high",
  initialVisualizerId = "spectrum",
  initialPresetId,
}: DemoExperienceProps) {
  const captureEnabled = isLiveListenEnabled();
  const demoEngineRef = useRef<DemoTrackEngine | null>(null);
  const browserEngineRef = useRef<BrowserCaptureEngine | null>(null);
  const micEngineRef = useRef<LiveListenEngine | null>(null);
  const featuresRef = useRef<AudioFeatureFrame>(silentFrame());
  const [captureInput, setCaptureInput] = useState<CaptureInputOption>("demo_track");
  const [status, setStatus] = useState<DemoTrackEngineStatus>("idle");
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const lastCaptureStatusRef = useRef<CaptureStatus>("idle");
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

  const disposeCaptureEngines = () => {
    const browser = browserEngineRef.current;
    const mic = micEngineRef.current;
    browserEngineRef.current = null;
    micEngineRef.current = null;
    if (browser) void browser.dispose();
    if (mic) void mic.dispose();
  };

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
    if (captureInput !== "demo_track") {
      demoEngineRef.current = null;
      return;
    }
    const engine = new DemoTrackEngine({ trackUrl: DEMO_TRACK_URL, loop: true });
    demoEngineRef.current = engine;
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
      demoEngineRef.current = null;
    };
  }, [captureInput]);

  useEffect(() => {
    return () => {
      disposeCaptureEngines();
    };
  }, []);

  useEffect(() => {
    if (captureInput !== "browser_capture" && captureInput !== "microphone") {
      disposeCaptureEngines();
      return;
    }

    const engine =
      captureInput === "browser_capture" ? browserEngineRef.current : micEngineRef.current;
    if (!engine) return;

    lastCaptureStatusRef.current = "idle";
    let lastHud = 0;
    const threshold =
      captureInput === "browser_capture"
        ? BROWSER_CAPTURE_SOUND_THRESHOLD
        : LIVE_LISTEN_SOUND_THRESHOLD;
    const unsubscribe = engine.subscribe((event) => {
      featuresRef.current = event.frame;
      if (event.status !== lastCaptureStatusRef.current) {
        lastCaptureStatusRef.current = event.status;
        setCaptureStatus(event.status);
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
      void threshold;
    });
    return () => {
      unsubscribe();
    };
  }, [captureInput]);

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

  const selectCaptureInput = (option: CaptureInputOption) => {
    setErrorMessage(undefined);
    writeCaptureInputPreference(option);
    if (option === "demo_track") {
      disposeCaptureEngines();
      setCaptureInput(option);
      return;
    }
    disposeCaptureEngines();
    setCaptureStatus("idle");
    if (option === "browser_capture") {
      const engine = new BrowserCaptureEngine();
      browserEngineRef.current = engine;
      setCaptureInput(option);
      void engine.start();
      return;
    }
    const engine = new LiveListenEngine();
    micEngineRef.current = engine;
    setCaptureInput(option);
    void engine.start();
  };

  const stopCapture = () => {
    const browser = browserEngineRef.current;
    const mic = micEngineRef.current;
    if (browser) {
      void browser.stop();
      return;
    }
    if (mic) void mic.pause();
  };

  const busy =
    captureInput === "demo_track" ? status === "loading" : captureStatus === "requesting";
  const captureActive =
    captureStatus === "listening" || captureStatus === "waiting" || captureStatus === "paused";
  const canPlay =
    captureInput === "browser_capture" || captureInput === "microphone"
      ? captureStatus === "paused" || captureStatus === "idle" || captureStatus === "ended"
      : status === "ready" || status === "needs_gesture" || status === "paused";
  const canPause =
    captureInput === "browser_capture" || captureInput === "microphone"
      ? captureStatus === "listening" || captureStatus === "waiting"
      : status === "playing";
  const showUnsupported =
    captureInput === "demo_track" ? status === "unsupported" : captureStatus === "unsupported";
  const showError = captureInput === "demo_track" ? status === "error" : false;
  const albumArtUrl =
    visualizerId === "album_world"
      ? artwork.status === "ready"
        ? artwork.objectUrl
        : PLACEHOLDER_ARTWORK_PATH
      : null;
  const soundThreshold =
    captureInput === "browser_capture"
      ? BROWSER_CAPTURE_SOUND_THRESHOLD
      : LIVE_LISTEN_SOUND_THRESHOLD;

  const canvasQuality = qualityMode === "auto" ? quality : qualityMode;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.14em] text-prism-aurora">
            {variant === "combined"
              ? `Combined · ${inputTitle(captureInput)}`
              : inputTitle(captureInput)}
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
              if (captureInput === "browser_capture") {
                if (canPause) {
                  void browserEngineRef.current?.pause();
                  return;
                }
                void browserEngineRef.current?.start();
                return;
              }
              if (captureInput === "microphone") {
                if (canPause) {
                  void micEngineRef.current?.pause();
                  return;
                }
                void micEngineRef.current?.start();
                return;
              }
              if (canPause) {
                void demoEngineRef.current?.pause();
                return;
              }
              void demoEngineRef.current?.play();
            }}
          >
            {canPause ? "Pause" : captureInput === "demo_track" ? "Play" : "Start capture"}
          </button>
          {captureActive ? (
            <button type="button" className="prism-btn prism-btn-ghost" onClick={stopCapture}>
              Stop capture
            </button>
          ) : null}
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
        value={captureInput}
        allowCaptureMusic={captureEnabled}
        onSelect={selectCaptureInput}
      />
      {captureEnabled ? <CaptureCompatibilityNote /> : null}

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

      {captureInput === "browser_capture" || captureInput === "microphone" ? (
        <p className="text-sm text-prism-mist" data-testid="capture-music-privacy">
          {CAPTURE_PRIVACY}
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
              {captureInput === "browser_capture"
                ? "Requesting browser permission…"
                : captureInput === "microphone"
                  ? "Waiting for microphone permission…"
                  : "Loading Demo Track…"}
            </p>
          </div>
        ) : null}

        {showUnsupported && captureInput === "demo_track" ? (
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
                void demoEngineRef.current?.prepare().then(() => demoEngineRef.current?.play());
              }}
            >
              Retry
            </button>
          </div>
        ) : null}

        {captureInput === "browser_capture" || captureInput === "microphone" ? (
          <CaptureMusicStatusPanel
            status={captureStatus}
            source={captureInput === "browser_capture" ? "browser" : "microphone"}
            errorMessage={errorMessage}
            hasSound={hud.energy >= soundThreshold}
            inputLevel={hud.energy}
            onRetry={() => {
              if (captureInput === "browser_capture") {
                void browserEngineRef.current?.start();
                return;
              }
              void micEngineRef.current?.start();
            }}
            onStop={stopCapture}
            onUseDemoTrack={() => {
              selectCaptureInput("demo_track");
            }}
            onUseMicrophone={
              captureInput === "browser_capture"
                ? () => {
                    selectCaptureInput("microphone");
                  }
                : undefined
            }
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
        <p className="text-sm text-prism-mist">
          {statusLabel(captureInput, status, captureStatus)}
        </p>
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

"use client";

import { useEffect, useRef, useState } from "react";
import { DemoTrackEngine, silentFrame, type DemoTrackEngineStatus } from "@prism/audio-engine";
import type { AudioFeatureFrame, QualityTier } from "@prism/contracts";
import { VisualizerCanvas } from "@prism/visual-engine";
import { spectrumPlugin } from "@prism/visualizers";

const DEMO_TRACK_URL = "/audio/demo-track.wav";
const DEMO_TRACK_TITLE = "Prism Demo Loop";
const DEMO_TRACK_DESCRIPTION =
  "Original synthetic royalty-free loop generated for Prism (16s, ~96 BPM).";

export type DemoExperienceVariant = "demo" | "combined";

type DemoExperienceProps = {
  variant: DemoExperienceVariant;
  quality?: QualityTier;
};

function statusLabel(status: DemoTrackEngineStatus): string {
  switch (status) {
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

export function DemoExperience({ variant, quality = "high" }: DemoExperienceProps) {
  const engineRef = useRef<DemoTrackEngine | null>(null);
  const featuresRef = useRef<AudioFeatureFrame>(silentFrame());
  const [status, setStatus] = useState<DemoTrackEngineStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [hud, setHud] = useState({ energy: 0, onset: false, bands: 32 });

  useEffect(() => {
    const engine = new DemoTrackEngine({ trackUrl: DEMO_TRACK_URL, loop: true });
    engineRef.current = engine;
    let lastHud = 0;
    const unsubscribe = engine.subscribe((event) => {
      featuresRef.current = event.frame;
      setStatus(event.status);
      setErrorMessage(event.errorMessage);
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      if (now - lastHud > 200) {
        lastHud = now;
        setHud({
          energy: event.frame.energy,
          onset: event.frame.onset,
          bands: event.frame.bands.length,
        });
      }
    });
    void engine.prepare();

    return () => {
      unsubscribe();
      void engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const busy = status === "loading";
  const canPlay = status === "ready" || status === "needs_gesture" || status === "paused";
  const canPause = status === "playing";
  const showUnsupported = status === "unsupported";
  const showError = status === "error";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.14em] text-prism-aurora">
            {variant === "combined" ? "Combined · Demo Track" : "Demo Track"}
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-prism-foam sm:text-5xl">
            Spectrum
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
              const el = document.querySelector<HTMLElement>("[data-visualizer='spectrum']");
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
        </div>
      </div>

      <div
        className="relative min-h-[min(70vh,36rem)] flex-1 overflow-hidden rounded-sm border border-prism-slate bg-prism-deep/70"
        role="region"
        aria-label="Spectrum visualizer"
      >
        {busy ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-prism-ink/50"
            role="status"
          >
            <p className="text-prism-foam">Loading Demo Track…</p>
          </div>
        ) : null}

        {showUnsupported ? (
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

        <VisualizerCanvas
          plugin={spectrumPlugin}
          featuresRef={featuresRef}
          quality={quality}
          className="h-full min-h-[min(70vh,36rem)] w-full"
          fallback={
            <div className="flex h-full min-h-[min(70vh,36rem)] items-center justify-center p-6">
              <p className="max-w-md text-center text-prism-foam">
                WebGL is unavailable. Audio can still play, but Spectrum cannot render.
              </p>
            </div>
          }
        />
      </div>

      <div className="space-y-2" aria-live="polite">
        <p className="text-sm text-prism-mist">{statusLabel(status)}</p>
        {errorMessage && status === "needs_gesture" ? (
          <p className="text-sm text-prism-ember">{errorMessage}</p>
        ) : null}
        <p className="text-xs text-prism-mist/80">
          Energy {hud.energy.toFixed(2)} · onset {hud.onset ? "yes" : "no"} · bands {hud.bands}
        </p>
      </div>
    </div>
  );
}

"use client";

import type { BrowserCaptureEngineStatus, LiveListenEngineStatus } from "@prism/audio-engine";
import type { Ref } from "react";

export type CaptureMusicUiStatus = BrowserCaptureEngineStatus | LiveListenEngineStatus;

export type CaptureMusicSource = "browser" | "microphone";

type CaptureMusicStatusPanelProps = {
  status: CaptureMusicUiStatus;
  source: CaptureMusicSource;
  errorMessage?: string;
  /** True when numeric input energy is above the sound-detected threshold. */
  hasSound?: boolean;
  /** 0–1 input level for the controller meter. Prefer mutating the fill via meterFillRef. */
  inputLevel?: number;
  meterFillRef?: Ref<HTMLDivElement>;
  onRetry: () => void;
  onStop?: () => void;
  onUseDemoTrack: () => void;
  onUseMicrophone?: () => void;
};

function copyForStatus(
  status: CaptureMusicUiStatus,
  source: CaptureMusicSource,
  hasSound: boolean,
  errorMessage?: string,
): string {
  if (source === "browser") {
    switch (status) {
      case "idle":
        return "Choose music source — pick the tab or system audio playing your music.";
      case "requesting":
        return "Requesting browser permission… Select the playing tab/window and enable Share tab audio or Share system audio.";
      case "waiting":
        return "Connected — waiting for audio.";
      case "listening":
        return hasSound
          ? "Connected — music detected. Analysis stays on this device; audio and screen are never sent."
          : "Connected — waiting for audio.";
      case "paused":
        return "Capture paused. Click Capture Music to resume or Stop capture to release sharing.";
      case "no_audio":
        return (
          errorMessage ??
          "No audio was shared. Try again and make sure Share tab audio or Share system audio is enabled."
        );
      case "ended":
        return (
          errorMessage ?? "Sharing stopped. Click Capture Music to choose a music source again."
        );
      case "inactive":
        return (
          errorMessage ??
          "Audio context is inactive. Click Capture Music again after interacting with the page."
        );
      case "denied":
        return (
          errorMessage ??
          "Capture was blocked or denied. Try again, or use Microphone / Demo Track."
        );
      case "unsupported":
        return (
          errorMessage ??
          "Browser/system audio unsupported here. Prefer Chrome or Edge on desktop, or use Microphone / Demo Track."
        );
      case "unavailable":
        return errorMessage ?? "Browser/system audio is unavailable. Try Microphone or Demo Track.";
      case "error":
        return errorMessage ?? "Capture Music failed. Try again or use Microphone / Demo Track.";
      default:
        return "Capture Music is idle.";
    }
  }

  switch (status) {
    case "requesting":
      return "Requesting microphone permission…";
    case "listening":
      return hasSound
        ? "Microphone — sound detected. Analysis stays on this device; audio is not recorded or sent."
        : "Microphone — waiting for sound.";
    case "waiting":
      return "Microphone — waiting for sound.";
    case "paused":
      return "Microphone capture is paused.";
    case "inactive":
      return (
        errorMessage ??
        "Audio context is inactive. Tap Microphone again after interacting with the page."
      );
    case "denied":
      return (
        errorMessage ??
        "Microphone permission was denied. Allow the microphone for this site, then try again."
      );
    case "unavailable":
      return errorMessage ?? "No microphone was found on this device.";
    case "unsupported":
      return errorMessage ?? "This browser cannot access the microphone.";
    case "error":
      return errorMessage ?? "Could not start microphone capture.";
    case "no_audio":
    case "ended":
      return errorMessage ?? "Microphone capture stopped.";
    case "idle":
    default:
      return "Microphone is idle.";
  }
}

export function CaptureMusicStatusPanel({
  status,
  source,
  errorMessage,
  hasSound = false,
  inputLevel = 0,
  meterFillRef,
  onRetry,
  onStop,
  onUseDemoTrack,
  onUseMicrophone,
}: CaptureMusicStatusPanelProps) {
  const connected = status === "listening" || status === "waiting" || status === "paused";
  const overlay =
    status === "requesting" ||
    status === "idle" ||
    status === "denied" ||
    status === "unavailable" ||
    status === "unsupported" ||
    status === "inactive" ||
    status === "error" ||
    status === "no_audio" ||
    status === "ended";

  if (!connected && !overlay) return null;
  if (status === "idle" && source !== "browser") return null;

  const isAlert =
    status === "denied" ||
    status === "unavailable" ||
    status === "unsupported" ||
    status === "inactive" ||
    status === "error" ||
    status === "no_audio" ||
    status === "ended";

  const detail =
    status === "listening" || status === "waiting" ? (hasSound ? "sound" : "waiting") : status;
  const clamped = Math.min(1, Math.max(0, inputLevel));
  const showMeter = status === "listening" || status === "waiting";

  return (
    <div
      className={
        overlay
          ? "absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-prism-ink/80 p-6"
          : "pointer-events-none absolute bottom-3 left-3 right-3 z-10 flex flex-col items-center gap-2"
      }
      role={isAlert ? "alert" : "status"}
      data-testid="capture-music-status"
      data-capture-source={source}
      data-live-listen-status={status}
      data-live-listen-detail={detail}
    >
      <p className="max-w-md text-center text-prism-foam">
        {copyForStatus(status, source, hasSound, errorMessage)}
      </p>
      {showMeter ? (
        <div
          className="mx-auto mt-2 h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-prism-slate/80"
          role="meter"
          aria-label="Input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clamped * 100)}
          data-testid="capture-music-meter"
        >
          <div
            ref={meterFillRef}
            className="h-full origin-left bg-prism-aurora"
            style={{ transform: `scaleX(${clamped})` }}
            data-testid="capture-music-meter-fill"
          />
        </div>
      ) : null}
      {connected && onStop ? (
        <div className="pointer-events-auto mt-2">
          <button type="button" className="prism-btn prism-btn-ghost" onClick={onStop}>
            Stop capture
          </button>
        </div>
      ) : null}
      {overlay && status !== "requesting" ? (
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="prism-btn prism-btn-primary" onClick={onRetry}>
            {status === "idle" ? "Choose music source" : "Try again"}
          </button>
          {source === "browser" && onUseMicrophone ? (
            <button type="button" className="prism-btn prism-btn-ghost" onClick={onUseMicrophone}>
              Use Microphone
            </button>
          ) : null}
          <button type="button" className="prism-btn prism-btn-ghost" onClick={onUseDemoTrack}>
            Use Demo Track
          </button>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import type { LiveListenEngineStatus } from "@prism/audio-engine";
import type { Ref } from "react";

type LiveListenStatusPanelProps = {
  status: LiveListenEngineStatus;
  errorMessage?: string;
  /** True when microphone energy is above the local sound-detected threshold. */
  hasSound?: boolean;
  /** 0–1 input level for the controller meter. Prefer mutating the fill via meterFillRef. */
  inputLevel?: number;
  meterFillRef?: Ref<HTMLDivElement>;
  onRetry: () => void;
  onUseDemoTrack: () => void;
};

function copyForStatus(
  status: LiveListenEngineStatus,
  hasSound: boolean,
  errorMessage?: string,
): string {
  switch (status) {
    case "requesting":
      return "Requesting microphone permission…";
    case "listening":
      return hasSound
        ? "Listening — sound detected. Analysis stays on this device; audio is not recorded or sent."
        : "Listening — waiting for sound.";
    case "paused":
      return "Live Listen is paused. The microphone is no longer being analyzed.";
    case "inactive":
      return (
        errorMessage ?? "Audio context is inactive. Tap Try again after interacting with the page."
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
      return errorMessage ?? "Could not start Live Listen.";
    case "idle":
    default:
      return "Live Listen is idle.";
  }
}

export function LiveListenStatusPanel({
  status,
  errorMessage,
  hasSound = false,
  inputLevel = 0,
  meterFillRef,
  onRetry,
  onUseDemoTrack,
}: LiveListenStatusPanelProps) {
  const blocking =
    status === "denied" ||
    status === "unavailable" ||
    status === "unsupported" ||
    status === "inactive" ||
    status === "error" ||
    status === "requesting";

  if (!blocking && status !== "listening" && status !== "paused") return null;

  const isAlert =
    status === "denied" ||
    status === "unavailable" ||
    status === "unsupported" ||
    status === "inactive" ||
    status === "error";

  const detail = status === "listening" ? (hasSound ? "sound" : "waiting") : status;
  const clamped = Math.min(1, Math.max(0, inputLevel));

  return (
    <div
      className={
        isAlert
          ? "absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-prism-ink/80 p-6"
          : status === "requesting"
            ? "absolute inset-0 z-10 flex items-center justify-center bg-prism-ink/50"
            : "pointer-events-none absolute bottom-3 left-3 right-3 z-10"
      }
      role={isAlert ? "alert" : "status"}
      data-testid="live-listen-status"
      data-live-listen-status={status}
      data-live-listen-detail={detail}
    >
      <p className="max-w-md text-center text-prism-foam">
        {copyForStatus(status, hasSound, errorMessage)}
      </p>
      {status === "listening" ? (
        <div
          className="mx-auto mt-2 h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-prism-slate/80"
          role="meter"
          aria-label="Microphone input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clamped * 100)}
          data-testid="live-listen-meter"
        >
          <div
            ref={meterFillRef}
            className="h-full origin-left bg-prism-aurora"
            style={{ transform: `scaleX(${clamped})` }}
            data-testid="live-listen-meter-fill"
          />
        </div>
      ) : null}
      {isAlert ? (
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="prism-btn prism-btn-primary" onClick={onRetry}>
            Try again
          </button>
          <button type="button" className="prism-btn prism-btn-ghost" onClick={onUseDemoTrack}>
            Use Demo Track
          </button>
        </div>
      ) : null}
    </div>
  );
}

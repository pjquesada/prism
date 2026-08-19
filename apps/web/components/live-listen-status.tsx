"use client";

import type { LiveListenEngineStatus } from "@prism/audio-engine";

type LiveListenStatusPanelProps = {
  status: LiveListenEngineStatus;
  errorMessage?: string;
  onRetry: () => void;
  onUseDemoTrack: () => void;
};

function copyForStatus(status: LiveListenEngineStatus, errorMessage?: string): string {
  switch (status) {
    case "requesting":
      return "Waiting for microphone permission…";
    case "listening":
      return "Live Listen is analyzing this device’s microphone locally. Audio is not recorded or sent.";
    case "paused":
      return "Live Listen is paused. The microphone is no longer being analyzed.";
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
  onRetry,
  onUseDemoTrack,
}: LiveListenStatusPanelProps) {
  const blocking =
    status === "denied" ||
    status === "unavailable" ||
    status === "unsupported" ||
    status === "error" ||
    status === "requesting";

  if (!blocking && status !== "listening" && status !== "paused") return null;

  const isAlert =
    status === "denied" ||
    status === "unavailable" ||
    status === "unsupported" ||
    status === "error";

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
    >
      <p className="max-w-md text-center text-prism-foam">{copyForStatus(status, errorMessage)}</p>
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

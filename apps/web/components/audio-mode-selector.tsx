"use client";

import type { AudioMode } from "@prism/contracts";

export type CaptureInputOption = "browser_capture" | "microphone" | "demo_track";

const OPTIONS: {
  id: CaptureInputOption;
  label: string;
  hint?: string;
  audioMode: AudioMode;
}[] = [
  {
    id: "browser_capture",
    label: "Capture Music",
    hint: "Recommended — browser tab or system audio",
    audioMode: "live_listen",
  },
  {
    id: "microphone",
    label: "Microphone",
    hint: "Fallback when tab/system audio is unavailable",
    audioMode: "live_listen",
  },
  {
    id: "demo_track",
    label: "Demo Track",
    audioMode: "demo_track",
  },
];

type AudioModeSelectorProps = {
  value: CaptureInputOption;
  onSelect: (option: CaptureInputOption) => void;
  disabled?: boolean;
  /** When false, hides Capture Music and Microphone (feature flag). */
  allowCaptureMusic?: boolean;
};

export function AudioModeSelector({
  value,
  onSelect,
  disabled = false,
  allowCaptureMusic = true,
}: AudioModeSelectorProps) {
  const options = allowCaptureMusic
    ? OPTIONS
    : OPTIONS.filter((option) => option.id === "demo_track");

  return (
    <div className="flex flex-col gap-3" role="group" aria-label="Audio input">
      <span className="text-sm text-prism-mist">Source</span>
      <div className="flex flex-wrap items-center gap-3">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={
              value === option.id ? "prism-btn prism-btn-primary" : "prism-btn prism-btn-ghost"
            }
            aria-pressed={value === option.id}
            disabled={disabled}
            data-testid={`audio-mode-${option.id}`}
            title={option.hint}
            onClick={() => onSelect(option.id)}
          >
            {option.label}
            {option.id === "browser_capture" ? (
              <span className="ml-2 text-[0.65rem] uppercase tracking-wide opacity-80">
                Recommended
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {value === "browser_capture" ? (
        <p className="max-w-2xl text-sm text-prism-mist" data-testid="capture-music-guidance">
          Your browser will show a sharing dialog. Select the tab, window, or screen playing music
          and enable <strong className="font-medium text-prism-foam">Share tab audio</strong> or{" "}
          <strong className="font-medium text-prism-foam">Share system audio</strong>. Prism ignores
          video and never plays a second copy of the audio.
        </p>
      ) : null}
    </div>
  );
}

export function captureOptionFromAudioMode(
  audioMode: AudioMode,
  preferred: CaptureInputOption = "browser_capture",
): CaptureInputOption {
  if (audioMode === "demo_track") return "demo_track";
  if (preferred === "microphone") return "microphone";
  return "browser_capture";
}

export function audioModeFromCaptureOption(option: CaptureInputOption): AudioMode {
  return option === "demo_track" ? "demo_track" : "live_listen";
}

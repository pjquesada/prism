"use client";

import type { AudioMode } from "@prism/contracts";

const MODES: { id: AudioMode; label: string }[] = [
  { id: "demo_track", label: "Demo Track" },
  { id: "live_listen", label: "Live Listen" },
];

type AudioModeSelectorProps = {
  value: AudioMode;
  onSelect: (mode: AudioMode) => void;
  disabled?: boolean;
  allowLiveListen?: boolean;
};

export function AudioModeSelector({
  value,
  onSelect,
  disabled = false,
  allowLiveListen = true,
}: AudioModeSelectorProps) {
  const modes = allowLiveListen ? MODES : MODES.filter((mode) => mode.id !== "live_listen");
  return (
    <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Audio mode">
      <span className="text-sm text-prism-mist">Source</span>
      {modes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className={
            value === mode.id ? "prism-btn prism-btn-primary" : "prism-btn prism-btn-ghost"
          }
          aria-pressed={value === mode.id}
          disabled={disabled}
          data-testid={`audio-mode-${mode.id}`}
          onClick={() => onSelect(mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

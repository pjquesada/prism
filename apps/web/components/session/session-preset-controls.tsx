"use client";

import { useMemo } from "react";
import {
  parseVisualizerParams,
  type ActivePresetSnapshot,
  type PresetConfig,
  type VisualizerId,
} from "@prism/contracts";

import { listMergedPresets } from "@/lib/guest-presets";
import { useGuestPresetStore } from "@/lib/use-guest-preset-store";

type SliderSpec = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
};

function slidersFor(visualizerId: VisualizerId): SliderSpec[] {
  const shared: SliderSpec[] = [
    { key: "sensitivity", label: "Intensity", min: 0.25, max: 3, step: 0.05 },
    { key: "baseHue", label: "Palette base", min: 0, max: 360, step: 1 },
    { key: "accentHue", label: "Palette accent", min: 0, max: 360, step: 1 },
  ];
  if (visualizerId === "spectrum") {
    return [...shared, { key: "beatEmphasis", label: "Motion", min: 0, max: 1, step: 0.01 }];
  }
  if (visualizerId === "particles") {
    return [
      ...shared,
      { key: "burstStrength", label: "Motion", min: 0, max: 1, step: 0.01 },
      { key: "sparkleIntensity", label: "Sparkle", min: 0, max: 2, step: 0.05 },
    ];
  }
  return [
    ...shared,
    { key: "parallaxStrength", label: "Motion", min: 0, max: 2, step: 0.05 },
    { key: "lightReactivity", label: "Light", min: 0, max: 2, step: 0.05 },
  ];
}

type SessionPresetControlsProps = {
  preset: ActivePresetSnapshot;
  disabled?: boolean;
  onApplyPreset: (preset: PresetConfig) => void;
  onParamsChange: (params: Record<string, unknown>) => void;
};

export function SessionPresetControls({
  preset,
  disabled = false,
  onApplyPreset,
  onParamsChange,
}: SessionPresetControlsProps) {
  const { users: userPresets, error: storeError } = useGuestPresetStore();
  const merged = useMemo(() => listMergedPresets(userPresets), [userPresets]);
  const matching = merged.filter((item) => item.visualizerId === preset.visualizerId);
  const params = parseVisualizerParams(preset.visualizerId, preset.params);
  const sliders = slidersFor(preset.visualizerId);
  const selectedId = matching.some((item) => item.id === preset.presetId)
    ? preset.presetId
    : (matching.find((item) => item.isBuiltIn)?.id ?? "");

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="session-preset-controls">
      <div className="space-y-3">
        <h2 className="font-display text-lg text-prism-foam">Preset</h2>
        <label className="block text-sm text-prism-mist">
          Active preset
          <select
            className="mt-1 w-full rounded-sm border border-prism-slate bg-prism-ink px-3 py-2 text-prism-foam"
            value={selectedId ?? ""}
            disabled={disabled || matching.length === 0}
            data-testid="session-preset-select"
            onChange={(event) => {
              const next = matching.find((item) => item.id === event.target.value);
              if (next) onApplyPreset(next);
            }}
          >
            {matching.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.isBuiltIn ? " (built-in)" : ""}
              </option>
            ))}
          </select>
        </label>
        {storeError ? (
          <p className="text-sm text-prism-ember" role="alert">
            {storeError}
          </p>
        ) : null}
        {preset.visualizerId === "album_world" ? (
          <p className="text-sm text-prism-mist">
            Album World uses local placeholder art on each display. Artwork files are not sent
            across the session.
          </p>
        ) : null}
      </div>
      <div className="space-y-3">
        <h2 className="font-display text-lg text-prism-foam">Live params</h2>
        {sliders.map((slider) => (
          <label key={slider.key} className="block text-sm text-prism-mist">
            {slider.label}
            <input
              type="range"
              min={slider.min}
              max={slider.max}
              step={slider.step}
              className="mt-1 w-full"
              disabled={disabled}
              aria-label={slider.label}
              data-testid={`param-${slider.key}`}
              value={Number(params[slider.key] ?? slider.min)}
              onChange={(event) => {
                onParamsChange({
                  ...params,
                  [slider.key]: Number(event.target.value),
                });
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

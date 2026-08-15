"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { silentFrame } from "@prism/audio-engine";
import {
  defaultParamsForVisualizer,
  parseVisualizerParams,
  type AudioFeatureFrame,
  type PresetConfig,
} from "@prism/contracts";
import { VisualizerCanvas } from "@prism/visual-engine";
import { requireVisualizerPlugin } from "@prism/visualizers";

import {
  createBlankPreset,
  listMergedPresets,
  resetPresetParams,
  updatePresetParams,
} from "@/lib/guest-presets";
import { PLACEHOLDER_ARTWORK_PATH } from "@/lib/local-artwork";
import { useGuestPresetStore } from "@/lib/use-guest-preset-store";

type PresetEditorProps = {
  presetId: string;
};

function toDraft(preset: PresetConfig): PresetConfig {
  return {
    ...preset,
    params: parseVisualizerParams(preset.visualizerId, preset.params),
  };
}

export function PresetEditor({ presetId }: PresetEditorProps) {
  const featuresRef = useRef<AudioFeatureFrame>(silentFrame());
  const { users: userPresets, error: storeError, replaceUsers } = useGuestPresetStore();
  const merged = useMemo(() => listMergedPresets(userPresets), [userPresets]);
  const source = merged.find((preset) => preset.id === presetId) ?? null;

  const [draft, setDraft] = useState<PresetConfig>(() =>
    createBlankPreset("spectrum", "Untitled preset"),
  );
  const [dirty, setDirty] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const rafRef = useRef(0);

  const displayDraft =
    !dirty && source ? toDraft(source) : dirty ? draft : source ? toDraft(source) : draft;

  useEffect(() => {
    const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      featuresRef.current = {
        ...silentFrame(now),
        beatPhase: (t * 0.15) % 1,
        energy: 0.15 + Math.sin(t) * 0.05,
        bass: 0.2,
        mid: 0.18,
        high: 0.12,
      };
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const plugin = useMemo(
    () => requireVisualizerPlugin(displayDraft.visualizerId),
    [displayDraft.visualizerId],
  );
  const error = localError ?? storeError;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm uppercase tracking-[0.14em] text-prism-aurora">Live preview</p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-prism-foam">
          {displayDraft.name}
        </h1>
        <p className="mt-2 text-prism-mist">
          {displayDraft.isBuiltIn
            ? "Built-in presets are read-only. Save a duplicate to edit."
            : "Edits preview instantly and stay on this device when saved."}
        </p>
      </div>

      <div className="min-h-[20rem] overflow-hidden rounded-sm border border-prism-slate">
        <VisualizerCanvas
          plugin={plugin}
          featuresRef={featuresRef}
          quality="medium"
          adaptiveQuality={false}
          params={displayDraft.params}
          albumArtUrl={
            displayDraft.visualizerId === "album_world" ? PLACEHOLDER_ARTWORK_PATH : null
          }
          className="h-[20rem] w-full"
        />
      </div>

      <label className="block text-sm text-prism-mist">
        Name
        <input
          className="mt-1 w-full rounded-sm border border-prism-slate bg-prism-ink px-3 py-2 text-prism-foam"
          value={displayDraft.name}
          disabled={displayDraft.isBuiltIn}
          onChange={(event) => {
            setDirty(true);
            setDraft({ ...displayDraft, name: event.target.value });
          }}
        />
      </label>

      <label className="block text-sm text-prism-mist">
        Sensitivity
        <input
          type="range"
          min={0.25}
          max={3}
          step={0.05}
          className="mt-1 w-full"
          disabled={displayDraft.isBuiltIn}
          value={Number(displayDraft.params.sensitivity ?? 1)}
          onChange={(event) => {
            setDirty(true);
            setDraft({
              ...displayDraft,
              params: {
                ...displayDraft.params,
                sensitivity: Number(event.target.value),
              },
            });
          }}
        />
      </label>

      {error ? (
        <p className="text-sm text-prism-ember" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="prism-btn prism-btn-primary"
          disabled={displayDraft.isBuiltIn}
          onClick={() => {
            const saved = updatePresetParams(displayDraft, displayDraft.params);
            const named = { ...saved, name: displayDraft.name };
            replaceUsers([...userPresets.filter((p) => p.id !== named.id), named]);
            setLocalError(null);
            setDraft(named);
            setDirty(true);
          }}
        >
          Save
        </button>
        <button
          type="button"
          className="prism-btn prism-btn-ghost"
          onClick={() => {
            const reset = resetPresetParams(displayDraft);
            setDirty(true);
            setDraft({
              ...reset,
              name: displayDraft.name,
              params: defaultParamsForVisualizer(displayDraft.visualizerId),
            });
          }}
        >
          Reset params
        </button>
        <Link href="/presets" className="prism-btn prism-btn-ghost">
          Back to presets
        </Link>
        <Link href="/demo" className="prism-btn prism-btn-ghost">
          Open demo
        </Link>
      </div>
    </div>
  );
}

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
  loadGuestPresets,
  resetPresetParams,
  saveGuestPresets,
  updatePresetParams,
} from "@/lib/guest-presets";
import { PLACEHOLDER_ARTWORK_PATH } from "@/lib/local-artwork";

type PresetEditorProps = {
  presetId: string;
};

export function PresetEditor({ presetId }: PresetEditorProps) {
  const featuresRef = useRef<AudioFeatureFrame>(silentFrame());
  const [userPresets, setUserPresets] = useState<PresetConfig[]>([]);
  const [draft, setDraft] = useState<PresetConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const loaded = loadGuestPresets();
    if (!loaded.ok) {
      setError(loaded.error);
      return;
    }
    setUserPresets(loaded.value);
    const merged = listMergedPresets(loaded.value);
    const found = merged.find((p) => p.id === presetId);
    if (found) {
      setDraft({
        ...found,
        params: parseVisualizerParams(found.visualizerId, found.params),
        isBuiltIn: found.isBuiltIn,
      });
    } else {
      setDraft(createBlankPreset("spectrum", "Untitled preset"));
    }
  }, [presetId]);

  // Ambient silent preview motion via beatPhase drift for live param feedback without audio.
  useEffect(() => {
    let raf = 0;
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
      setTick((value) => (value + 1) % 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const plugin = useMemo(
    () => requireVisualizerPlugin(draft?.visualizerId ?? "spectrum"),
    [draft?.visualizerId],
  );

  if (!draft) {
    return (
      <p className="text-prism-mist" role="status">
        Loading preset…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm uppercase tracking-[0.14em] text-prism-aurora">Live preview</p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-prism-foam">{draft.name}</h1>
        <p className="mt-2 text-prism-mist">
          {draft.isBuiltIn
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
          params={draft.params}
          albumArtUrl={
            draft.visualizerId === "album_world" ? PLACEHOLDER_ARTWORK_PATH : null
          }
          className="h-[20rem] w-full"
        />
        <span className="sr-only">preview frame {tick}</span>
      </div>

      <label className="block text-sm text-prism-mist">
        Name
        <input
          className="mt-1 w-full rounded-sm border border-prism-slate bg-prism-ink px-3 py-2 text-prism-foam"
          value={draft.name}
          disabled={draft.isBuiltIn}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
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
          disabled={draft.isBuiltIn}
          value={Number(draft.params.sensitivity ?? 1)}
          onChange={(event) => {
            setDraft({
              ...draft,
              params: {
                ...draft.params,
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
          disabled={draft.isBuiltIn}
          onClick={() => {
            const saved = updatePresetParams(draft, draft.params);
            const named = { ...saved, name: draft.name };
            const next = [...userPresets.filter((p) => p.id !== named.id), named];
            setUserPresets(next);
            const result = saveGuestPresets(next);
            setError(result.ok ? null : result.error);
            setDraft(named);
          }}
        >
          Save
        </button>
        <button
          type="button"
          className="prism-btn prism-btn-ghost"
          onClick={() => {
            const reset = resetPresetParams(draft);
            setDraft({
              ...reset,
              name: draft.name,
              params: defaultParamsForVisualizer(draft.visualizerId),
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

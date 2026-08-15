"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PresetConfig } from "@prism/contracts";

import {
  duplicatePreset,
  listMergedPresets,
  loadGuestPresets,
  saveGuestPresets,
} from "@/lib/guest-presets";

export function PresetBrowser() {
  const [userPresets, setUserPresets] = useState<PresetConfig[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loaded = loadGuestPresets();
    if (!loaded.ok) {
      setError(loaded.error);
      return;
    }
    setUserPresets(loaded.value);
  }, []);

  const presets = useMemo(() => listMergedPresets(userPresets), [userPresets]);

  return (
    <div className="space-y-4">
      {error ? (
        <p className="text-sm text-prism-ember" role="alert">
          {error}
        </p>
      ) : null}
      {presets.length === 0 ? (
        <p className="text-prism-mist" role="status">
          No presets available.
        </p>
      ) : (
        <ul className="divide-y divide-prism-slate border border-prism-slate">
          {presets.map((preset) => (
            <li
              key={preset.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p className="font-display text-lg text-prism-foam">{preset.name}</p>
                <p className="text-sm text-prism-mist">
                  {preset.visualizerId}
                  {preset.isBuiltIn ? " · built-in" : " · local"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/presets/${preset.id}`}
                  className="prism-btn prism-btn-ghost"
                >
                  Edit
                </Link>
                <Link
                  href={`/demo?preset=${encodeURIComponent(preset.id)}&visualizer=${encodeURIComponent(preset.visualizerId)}`}
                  className="prism-btn prism-btn-ghost"
                >
                  Preview
                </Link>
                <button
                  type="button"
                  className="prism-btn prism-btn-ghost"
                  onClick={() => {
                    const copy = duplicatePreset(preset);
                    const next = [...userPresets, copy];
                    setUserPresets(next);
                    const saved = saveGuestPresets(next);
                    setError(saved.ok ? null : saved.error);
                  }}
                >
                  Duplicate
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

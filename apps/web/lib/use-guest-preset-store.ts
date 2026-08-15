"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { PresetConfig } from "@prism/contracts";

import { loadGuestPresets, saveGuestPresets } from "@/lib/guest-presets";

const LISTENERS = new Set<() => void>();

function emit(): void {
  for (const listener of LISTENERS) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  LISTENERS.add(onStoreChange);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStoreChange);
  }
  return () => {
    LISTENERS.delete(onStoreChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStoreChange);
    }
  };
}

type GuestPresetSnapshot = {
  users: PresetConfig[];
  error: string | null;
};

let cached: GuestPresetSnapshot | null = null;

function readSnapshot(): GuestPresetSnapshot {
  const loaded = loadGuestPresets();
  const next: GuestPresetSnapshot = loaded.ok
    ? { users: loaded.value, error: null }
    : { users: [], error: loaded.error };
  cached = next;
  return next;
}

function getSnapshot(): GuestPresetSnapshot {
  return cached ?? readSnapshot();
}

function getServerSnapshot(): GuestPresetSnapshot {
  return { users: [], error: null };
}

export function useGuestPresetStore(): {
  users: PresetConfig[];
  error: string | null;
  replaceUsers: (next: PresetConfig[]) => void;
  refresh: () => void;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const replaceUsers = useCallback((next: PresetConfig[]) => {
    const saved = saveGuestPresets(next);
    cached = saved.ok
      ? { users: next.filter((preset) => !preset.isBuiltIn), error: null }
      : { users: next.filter((preset) => !preset.isBuiltIn), error: saved.error };
    emit();
  }, []);

  const refresh = useCallback(() => {
    readSnapshot();
    emit();
  }, []);

  return {
    users: snapshot.users,
    error: snapshot.error,
    replaceUsers,
    refresh,
  };
}

import {
  GUEST_PRESET_STORAGE_KEY,
  MAX_GUEST_PRESETS,
  PRESET_SCHEMA_VERSION,
  createBuiltInPresets,
  createUserPreset,
  guestPresetStoreSchema,
  parseVisualizerParams,
  presetConfigSchema,
  type PresetConfig,
  type VisualizerId,
} from "@prism/contracts";

export type GuestPresetResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function builtIns(): PresetConfig[] {
  return createBuiltInPresets().map((preset) =>
    presetConfigSchema.parse({
      ...preset,
      params: { ...preset.params },
    }),
  );
}

export function listMergedPresets(userPresets: PresetConfig[]): PresetConfig[] {
  return [...builtIns(), ...userPresets.filter((p) => !p.isBuiltIn)];
}

export function loadGuestPresets(): GuestPresetResult<PresetConfig[]> {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return { ok: true, value: [] };
  }
  try {
    const raw = window.localStorage.getItem(GUEST_PRESET_STORAGE_KEY);
    if (!raw) return { ok: true, value: [] };
    const parsedJson: unknown = JSON.parse(raw);
    const parsed = guestPresetStoreSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return { ok: false, error: "Saved presets were invalid and could not be loaded." };
    }
    const users = parsed.data.presets
      .filter((preset) => !preset.isBuiltIn)
      .map((preset) =>
        presetConfigSchema.parse({
          ...preset,
          params: parseVisualizerParams(preset.visualizerId, preset.params),
        }),
      );
    return { ok: true, value: users };
  } catch {
    return {
      ok: false,
      error: "Local storage is unavailable or blocked, so guest presets could not be loaded.",
    };
  }
}

export function saveGuestPresets(userPresets: PresetConfig[]): GuestPresetResult<true> {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return { ok: false, error: "Local storage is unavailable in this environment." };
  }
  try {
    const trimmed = userPresets.filter((p) => !p.isBuiltIn).slice(0, MAX_GUEST_PRESETS);
    const payload = guestPresetStoreSchema.parse({
      schemaVersion: PRESET_SCHEMA_VERSION,
      presets: trimmed,
    });
    window.localStorage.setItem(GUEST_PRESET_STORAGE_KEY, JSON.stringify(payload));
    return { ok: true, value: true };
  } catch {
    return {
      ok: false,
      error: "Could not save presets to local storage (quota or privacy settings).",
    };
  }
}

export function duplicatePreset(source: PresetConfig, name?: string): PresetConfig {
  return createUserPreset({
    name: name ?? `${source.name} Copy`,
    visualizerId: source.visualizerId,
    params: { ...source.params },
  });
}

export function updatePresetParams(
  preset: PresetConfig,
  params: Record<string, unknown>,
): PresetConfig {
  return presetConfigSchema.parse({
    ...preset,
    isBuiltIn: false,
    params: parseVisualizerParams(preset.visualizerId, params),
    updatedAt: new Date().toISOString(),
  });
}

export function resetPresetParams(preset: PresetConfig): PresetConfig {
  const builtin = builtIns().find((p) => p.visualizerId === preset.visualizerId);
  const params = builtin ? { ...builtin.params } : parseVisualizerParams(preset.visualizerId, {});
  return updatePresetParams({ ...preset, isBuiltIn: false }, params);
}

export function createBlankPreset(visualizerId: VisualizerId, name: string): PresetConfig {
  return createUserPreset({
    name,
    visualizerId,
    params: parseVisualizerParams(visualizerId, {}),
  });
}

import { z } from "zod";

import { albumWorldParamsDefaults, albumWorldParamsSchema } from "./album-world.js";
import { spectrumParamsDefaults, spectrumParamsSchema } from "./spectrum.js";
import { particlesParamsDefaults, particlesParamsSchema } from "./particles.js";

const visualizerIdForPresetSchema = z.enum([
  "spectrum",
  "particles",
  "album_world",
  "dreamscape",
]);

type VisualizerIdForPreset = z.infer<typeof visualizerIdForPresetSchema>;

/** Bump when guest localStorage shape changes incompatibly. */
export const PRESET_SCHEMA_VERSION = 1 as const;

export const presetSchemaVersionSchema = z.literal(PRESET_SCHEMA_VERSION);

export const presetConfigSchema = z.object({
  schemaVersion: presetSchemaVersionSchema,
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  visualizerId: visualizerIdForPresetSchema,
  ownerUserId: z.string().nullable(),
  params: z.record(z.string(), z.unknown()),
  isBuiltIn: z.boolean().default(false),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type PresetConfig = z.infer<typeof presetConfigSchema>;

export const guestPresetStoreSchema = z.object({
  schemaVersion: presetSchemaVersionSchema,
  presets: z.array(presetConfigSchema),
});

export type GuestPresetStore = z.infer<typeof guestPresetStoreSchema>;

export const GUEST_PRESET_STORAGE_KEY = "prism.presets.v1";
export const MAX_GUEST_PRESETS = 40;

export function defaultParamsForVisualizer(
  visualizerId: VisualizerIdForPreset,
): Record<string, unknown> {
  switch (visualizerId) {
    case "spectrum":
      return { ...spectrumParamsDefaults };
    case "particles":
      return { ...particlesParamsDefaults };
    case "album_world":
      return { ...albumWorldParamsDefaults };
    case "dreamscape":
      return {};
    default: {
      const _exhaustive: never = visualizerId;
      return _exhaustive;
    }
  }
}

export function parseVisualizerParams(
  visualizerId: VisualizerIdForPreset,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  switch (visualizerId) {
    case "spectrum": {
      const parsed = spectrumParamsSchema.safeParse(raw);
      return parsed.success ? parsed.data : { ...spectrumParamsDefaults };
    }
    case "particles": {
      const parsed = particlesParamsSchema.safeParse(raw);
      return parsed.success ? parsed.data : { ...particlesParamsDefaults };
    }
    case "album_world": {
      const parsed = albumWorldParamsSchema.safeParse(raw);
      return parsed.success ? parsed.data : { ...albumWorldParamsDefaults };
    }
    case "dreamscape":
      return { ...raw };
    default: {
      const _exhaustive: never = visualizerId;
      return _exhaustive;
    }
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

export function createBuiltInPresets(): readonly PresetConfig[] {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const builtins: PresetConfig[] = [
    {
      schemaVersion: PRESET_SCHEMA_VERSION,
      id: "builtin-spectrum-calm",
      name: "Spectrum Calm",
      visualizerId: "spectrum",
      ownerUserId: null,
      params: { ...spectrumParamsDefaults },
      isBuiltIn: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      schemaVersion: PRESET_SCHEMA_VERSION,
      id: "builtin-particles-pulse",
      name: "Particles Pulse",
      visualizerId: "particles",
      ownerUserId: null,
      params: {
        ...particlesParamsDefaults,
        burstStrength: 0.55,
        sparkleIntensity: 1.15,
      },
      isBuiltIn: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      schemaVersion: PRESET_SCHEMA_VERSION,
      id: "builtin-album-world-drift",
      name: "Album World Drift",
      visualizerId: "album_world",
      ownerUserId: null,
      params: {
        ...albumWorldParamsDefaults,
        parallaxStrength: 1.1,
        fogDensity: 0.4,
      },
      isBuiltIn: true,
      createdAt,
      updatedAt: createdAt,
    },
  ];
  return Object.freeze(
    builtins.map((preset) =>
      Object.freeze({
        ...preset,
        params: Object.freeze({ ...preset.params }),
      }),
    ),
  );
}

export function createUserPreset(input: {
  name: string;
  visualizerId: VisualizerIdForPreset;
  params: Record<string, unknown>;
  id?: string;
}): PresetConfig {
  const now = isoNow();
  return presetConfigSchema.parse({
    schemaVersion: PRESET_SCHEMA_VERSION,
    id: input.id ?? `user-${cryptoRandomId()}`,
    name: input.name,
    visualizerId: input.visualizerId,
    ownerUserId: null,
    params: parseVisualizerParams(input.visualizerId, input.params),
    isBuiltIn: false,
    createdAt: now,
    updatedAt: now,
  });
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

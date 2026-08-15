import { z } from "zod";

export const deviceRoleSchema = z.enum(["controller", "display", "combined"]);
export type DeviceRole = z.infer<typeof deviceRoleSchema>;

export const audioModeSchema = z.enum([
  "demo_track",
  "live_listen",
  "manual_sync",
  "ambient",
  "provider_companion",
]);
export type AudioMode = z.infer<typeof audioModeSchema>;

export const visualizerIdSchema = z.enum(["spectrum", "particles", "album_world", "dreamscape"]);
export type VisualizerId = z.infer<typeof visualizerIdSchema>;

export const qualityTierSchema = z.enum(["low", "medium", "high", "ultra"]);
export type QualityTier = z.infer<typeof qualityTierSchema>;

export const audioFeatureFrameSchema = z.object({
  timestampMs: z.number().nonnegative(),
  rms: z.number().min(0).max(1),
  peak: z.number().min(0).max(1),
  bpmEstimate: z.number().positive().nullable(),
  beatPhase: z.number().min(0).max(1),
  bands: z.array(z.number().min(0).max(1)),
  energy: z.number().min(0).max(1),
  onset: z.boolean(),
  /** Aggregate 0..1 band energies for visualizer reactivity. */
  bass: z.number().min(0).max(1),
  mid: z.number().min(0).max(1),
  high: z.number().min(0).max(1),
});
export type AudioFeatureFrame = z.infer<typeof audioFeatureFrameSchema>;

/** Deterministic silent/ambient fallback frame for later audio-engine phases. */
export function createSilentFeatureFrame(timestampMs = 0, bandCount = 32): AudioFeatureFrame {
  return {
    timestampMs,
    rms: 0,
    peak: 0,
    bpmEstimate: null,
    beatPhase: 0,
    bands: Array.from({ length: bandCount }, () => 0),
    energy: 0,
    onset: false,
    bass: 0,
    mid: 0,
    high: 0,
  };
}

export {
  spectrumParamsDefaults,
  spectrumParamsSchema,
  visualizerPluginMetaSchema,
  type SpectrumParams,
  type VisualizerPluginMeta,
} from "./spectrum.js";

export {
  particlesParamsDefaults,
  particlesParamsSchema,
  type ParticlesParams,
} from "./particles.js";

export {
  albumWorldParamsDefaults,
  albumWorldParamsSchema,
  type AlbumWorldParams,
} from "./album-world.js";

export {
  GUEST_PRESET_STORAGE_KEY,
  MAX_GUEST_PRESETS,
  PRESET_SCHEMA_VERSION,
  createBuiltInPresets,
  createUserPreset,
  defaultParamsForVisualizer,
  guestPresetStoreSchema,
  parseVisualizerParams,
  presetConfigSchema,
  presetSchemaVersionSchema,
  type GuestPresetStore,
  type PresetConfig,
} from "./presets.js";

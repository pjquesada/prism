import { z } from "zod";

export const spectrumParamsSchema = z.object({
  barCount: z.number().int().min(8).max(64).default(32),
  sensitivity: z.number().min(0.25).max(3).default(1),
  barGap: z.number().min(0).max(0.5).default(0.18),
  baseHue: z.number().min(0).max(360).default(168),
  accentHue: z.number().min(0).max(360).default(28),
  beatEmphasis: z.number().min(0).max(1).default(0.35),
});

export type SpectrumParams = z.infer<typeof spectrumParamsSchema>;

export const spectrumParamsDefaults: SpectrumParams = spectrumParamsSchema.parse({});

export const visualizerPluginMetaSchema = z.object({
  id: z.enum(["spectrum", "particles", "album_world", "dreamscape"]),
  label: z.string().min(1),
  description: z.string().min(1),
  supportsAlbumArt: z.boolean(),
  supportsDreamscapeKeyframes: z.boolean(),
  defaultQuality: z.enum(["low", "medium", "high", "ultra"]).optional(),
});

export type VisualizerPluginMeta = z.infer<typeof visualizerPluginMetaSchema>;

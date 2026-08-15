import { z } from "zod";

export const albumWorldParamsSchema = z.object({
  parallaxStrength: z.number().min(0).max(2).default(1),
  depthLayers: z.number().int().min(2).max(6).default(4),
  lightReactivity: z.number().min(0).max(2).default(1),
  displacement: z.number().min(0).max(2).default(0.7),
  fogDensity: z.number().min(0).max(1).default(0.35),
  baseHue: z.number().min(0).max(360).default(200),
  accentHue: z.number().min(0).max(360).default(28),
  sensitivity: z.number().min(0.25).max(3).default(1),
});

export type AlbumWorldParams = z.infer<typeof albumWorldParamsSchema>;

export const albumWorldParamsDefaults: AlbumWorldParams = albumWorldParamsSchema.parse({});

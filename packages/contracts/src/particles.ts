import { z } from "zod";

export const particlesParamsSchema = z.object({
  particleCount: z.number().int().min(64).max(4096).default(1024),
  bassSize: z.number().min(0.25).max(4).default(1.4),
  midFlow: z.number().min(0).max(2).default(1),
  sparkleIntensity: z.number().min(0).max(2).default(1),
  burstStrength: z.number().min(0).max(1).default(0.45),
  baseHue: z.number().min(0).max(360).default(168),
  accentHue: z.number().min(0).max(360).default(28),
  sensitivity: z.number().min(0.25).max(3).default(1),
});

export type ParticlesParams = z.infer<typeof particlesParamsSchema>;

export const particlesParamsDefaults: ParticlesParams = particlesParamsSchema.parse({});

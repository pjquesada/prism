import { z } from "zod";

import { audioFeatureEnvelopeSchema } from "./features.js";

export const realtimeBroadcastResultSchema = z.enum(["sent", "unavailable", "failed"]);
export type RealtimeBroadcastResult = z.infer<typeof realtimeBroadcastResultSchema>;

export const durableFallbackResultSchema = z.enum(["stored", "unavailable", "failed"]);
export type DurableFallbackResult = z.infer<typeof durableFallbackResultSchema>;

export const featureDeliveryTransportSchema = z.enum(["realtime", "fallback"]);
export type FeatureDeliveryTransport = z.infer<typeof featureDeliveryTransportSchema>;

export const featurePublishBodySchema = z
  .object({
    envelope: audioFeatureEnvelopeSchema,
  })
  .strict();

export const featurePublishResponseSchema = z
  .object({
    accepted: z.boolean(),
    frameSeq: z.number().int().nonnegative().optional(),
    realtimeBroadcast: realtimeBroadcastResultSchema.optional(),
    durableFallback: durableFallbackResultSchema.optional(),
    errorCategory: z.string().optional(),
  })
  .strict();

export type FeaturePublishResponse = z.infer<typeof featurePublishResponseSchema>;

export const featureFallbackQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(-1),
});

export const featureFallbackResponseSchema = z
  .object({
    envelope: audioFeatureEnvelopeSchema,
    frameSeq: z.number().int().nonnegative(),
    timestampMs: z.number().nonnegative(),
  })
  .strict();

export type FeatureFallbackResponse = z.infer<typeof featureFallbackResponseSchema>;

export const featureReceiptBodySchema = z
  .object({
    frameSeq: z.number().int().nonnegative(),
    receivedAtMs: z.number().nonnegative(),
    transport: featureDeliveryTransportSchema,
  })
  .strict();

export type FeatureReceiptBody = z.infer<typeof featureReceiptBodySchema>;

export const featureReceiptResponseSchema = z
  .object({
    accepted: z.boolean(),
    frameSeq: z.number().int().nonnegative().optional(),
    transport: featureDeliveryTransportSchema.optional(),
    receivedAtMs: z.number().nonnegative().optional(),
  })
  .strict();

export type FeatureReceiptResponse = z.infer<typeof featureReceiptResponseSchema>;

export const realtimeChannelStateSchema = z.enum([
  "idle",
  "subscribing",
  "SUBSCRIBED",
  "CHANNEL_ERROR",
  "TIMED_OUT",
  "CLOSED",
]);
export type RealtimeChannelState = z.infer<typeof realtimeChannelStateSchema>;

export const featureDeliveryPathSchema = z.enum(["realtime", "fallback", "none"]);
export type FeatureDeliveryPath = z.infer<typeof featureDeliveryPathSchema>;

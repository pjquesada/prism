import { z } from "zod";

import {
  audioModeSchema,
  deviceRoleSchema,
  qualityTierSchema,
  visualizerIdSchema,
} from "./domain.js";

/** Multi-display layout mode for session followers. */
export const displayModeSchema = z.enum(["mirror", "complementary"]);
export type DisplayMode = z.infer<typeof displayModeSchema>;

export const sessionStatusSchema = z.enum(["active", "ended"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/** Ambiguous-safe alphabet for six-character pairing codes. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" as const;
export const PAIRING_CODE_LENGTH = 6 as const;
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const PAIRING_MAX_ATTEMPTS = 8;
export const GUEST_CREDENTIAL_TTL_MS = 2 * 60 * 60 * 1000;
export const SESSION_HEARTBEAT_TIMEOUT_MS = 45_000;
export const MAX_SESSION_EVENT_BYTES = 8 * 1024;
export const MAX_PRESET_PARAMS_JSON_BYTES = 4 * 1024;

export const pairingCodeSchema = z
  .string()
  .length(PAIRING_CODE_LENGTH)
  .regex(new RegExp(`^[${PAIRING_CODE_ALPHABET}]+$`));

export type PairingCode = z.infer<typeof pairingCodeSchema>;

export const sessionDeviceSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().uuid(),
  deviceId: z.string().min(1),
  role: deviceRoleSchema,
  label: z.string().max(80).nullable(),
  displayMode: displayModeSchema.default("mirror"),
  lastSeenAt: z.string().min(1),
  isOnline: z.boolean(),
});
export type SessionDevice = z.infer<typeof sessionDeviceSchema>;

export const playbackStateSchema = z.object({
  audioMode: audioModeSchema,
  isPlaying: z.boolean(),
  positionMs: z.number().nonnegative(),
  rate: z.number().positive().max(2).default(1),
  trackId: z.string().min(1).default("demo-track"),
  updatedAt: z.string().min(1),
  seq: z.number().int().nonnegative(),
});
export type PlaybackState = z.infer<typeof playbackStateSchema>;

export const activePresetSnapshotSchema = z.object({
  visualizerId: visualizerIdSchema,
  qualityTier: qualityTierSchema,
  presetId: z.string().nullable(),
  params: z.record(z.string(), z.unknown()),
  updatedAt: z.string().min(1),
  seq: z.number().int().nonnegative(),
});
export type ActivePresetSnapshot = z.infer<typeof activePresetSnapshotSchema>;

export const guestSessionSchema = z.object({
  id: z.string().uuid(),
  hostDeviceId: z.string().min(1),
  status: sessionStatusSchema,
  displayMode: displayModeSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  closedAt: z.string().nullable(),
  seq: z.number().int().nonnegative(),
});
export type GuestSession = z.infer<typeof guestSessionSchema>;

export const sessionSnapshotSchema = z.object({
  session: guestSessionSchema,
  devices: z.array(sessionDeviceSchema),
  playback: playbackStateSchema,
  preset: activePresetSnapshotSchema,
});
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;

export const partialSessionPatchSchema = z.object({
  displayMode: displayModeSchema.optional(),
  playback: playbackStateSchema.partial().optional(),
  preset: activePresetSnapshotSchema.partial().optional(),
});
export type PartialSessionPatch = z.infer<typeof partialSessionPatchSchema>;

const envelopeBase = {
  seq: z.number().int().nonnegative(),
  sentAt: z.string().min(1),
  sessionId: z.string().uuid(),
  deviceId: z.string().min(1),
};

export const sessionMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.snapshot"),
    ...envelopeBase,
    payload: sessionSnapshotSchema,
  }),
  z.object({
    type: z.literal("session.patch"),
    ...envelopeBase,
    payload: partialSessionPatchSchema,
  }),
  z.object({
    type: z.literal("device.joined"),
    ...envelopeBase,
    payload: sessionDeviceSchema,
  }),
  z.object({
    type: z.literal("device.left"),
    ...envelopeBase,
    payload: z.object({ deviceId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("device.role"),
    ...envelopeBase,
    payload: z.object({ deviceId: z.string().min(1), role: deviceRoleSchema }),
  }),
  z.object({
    type: z.literal("playback.update"),
    ...envelopeBase,
    payload: playbackStateSchema,
  }),
  z.object({
    type: z.literal("preset.apply"),
    ...envelopeBase,
    payload: activePresetSnapshotSchema,
  }),
  z.object({
    type: z.literal("visual.intent"),
    ...envelopeBase,
    payload: z.object({
      visualizerId: visualizerIdSchema.optional(),
      qualityTier: qualityTierSchema.optional(),
      params: z.record(z.string(), z.unknown()).optional(),
      displayMode: displayModeSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal("display.mode"),
    ...envelopeBase,
    payload: z.object({ displayMode: displayModeSchema }),
  }),
  z.object({
    type: z.literal("handoff.request"),
    ...envelopeBase,
    payload: z.object({ targetDeviceId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("handoff.accept"),
    ...envelopeBase,
    payload: z.object({ controllerDeviceId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("ping"),
    ...envelopeBase,
    payload: z.object({ clientSentAtMs: z.number() }),
  }),
  z.object({
    type: z.literal("pong"),
    ...envelopeBase,
    payload: z.object({
      clientSentAtMs: z.number(),
      serverReceivedAtMs: z.number(),
      serverSentAtMs: z.number(),
    }),
  }),
  z.object({
    type: z.literal("heartbeat"),
    ...envelopeBase,
    payload: z.object({ deviceId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("snapshot.request"),
    ...envelopeBase,
    payload: z.object({ reason: z.string().optional() }),
  }),
  z.object({
    type: z.literal("error"),
    ...envelopeBase,
    payload: z.object({ code: z.string().min(1), message: z.string().min(1) }),
  }),
]);
export type SessionMessage = z.infer<typeof sessionMessageSchema>;

export const guestCredentialSchema = z.object({
  token: z.string().min(1),
  sessionId: z.string().uuid(),
  deviceId: z.string().min(1),
  role: deviceRoleSchema,
  expiresAt: z.string().min(1),
});
export type GuestCredential = z.infer<typeof guestCredentialSchema>;

/** Browser-visible session identity. Never includes the raw credential. */
export const publicGuestIdentitySchema = z.object({
  sessionId: z.string().uuid(),
  deviceId: z.string().min(1),
  role: deviceRoleSchema,
  expiresAt: z.string().min(1),
});
export type PublicGuestIdentity = z.infer<typeof publicGuestIdentitySchema>;

/** Non-sensitive metadata allowed in sessionStorage (never credentials or pairing codes). */
export const sessionClientMetaSchema = z.object({
  sessionId: z.string().uuid(),
  deviceId: z.string().min(1),
  role: deviceRoleSchema,
  intendedRoute: z.enum(["controller", "display", "combined"]).optional(),
});
export type SessionClientMeta = z.infer<typeof sessionClientMetaSchema>;

/** Wire allowlist reminder — never transmit raw audio, mic buffers, FFT arrays, or images. */
export const FORBIDDEN_SESSION_PAYLOAD_KEYS = [
  "audio",
  "pcm",
  "microphone",
  "fft",
  "bands",
  "frequencyData",
  "timeDomainData",
  "image",
  "imageData",
  "albumArt",
  "artworkBytes",
] as const;

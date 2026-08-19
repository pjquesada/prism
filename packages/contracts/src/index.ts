export {
  audioFeatureFrameSchema,
  audioModeSchema,
  createSilentFeatureFrame,
  deviceRoleSchema,
  qualityTierSchema,
  visualizerIdSchema,
  type AudioFeatureFrame,
  type AudioMode,
  type DeviceRole,
  type QualityTier,
  type VisualizerId,
} from "./domain.js";

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

export {
  FORBIDDEN_SESSION_PAYLOAD_KEYS,
  GUEST_CREDENTIAL_TTL_MS,
  MAX_PRESET_PARAMS_JSON_BYTES,
  MAX_SESSION_EVENT_BYTES,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  SESSION_HEARTBEAT_TIMEOUT_MS,
  activePresetSnapshotSchema,
  mergeActivePresetSnapshot,
  displayModeSchema,
  guestCredentialSchema,
  guestSessionSchema,
  pairingCodeSchema,
  partialSessionPatchSchema,
  playbackStateSchema,
  publicGuestIdentitySchema,
  sessionClientMetaSchema,
  sessionDeviceSchema,
  sessionMessageSchema,
  sessionSnapshotSchema,
  sessionStatusSchema,
  type ActivePresetPatch,
  type ActivePresetSnapshot,
  type DisplayMode,
  type GuestCredential,
  type GuestSession,
  type PairingCode,
  type PartialSessionPatch,
  type PlaybackState,
  type PublicGuestIdentity,
  type SessionClientMeta,
  type SessionDevice,
  type SessionMessage,
  type SessionSnapshot,
  type SessionStatus,
} from "./session.js";

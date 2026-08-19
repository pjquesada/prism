import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  GUEST_CREDENTIAL_TTL_MS,
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  defaultParamsForVisualizer,
  deviceRoleSchema,
  displayModeSchema,
  mergeActivePresetSnapshot,
  publicGuestIdentitySchema,
  sessionSnapshotSchema,
  type DeviceRole,
  type DisplayMode,
  type GuestCredential,
  type PublicGuestIdentity,
  type SessionMessage,
  type SessionSnapshot,
} from "@prism/contracts";
import type { Json } from "@prism/db";
import { generatePairingCode } from "@prism/sync-engine";

import { getSessionSigningSecret } from "@/lib/session/config";
import {
  digestGuestCredential,
  digestPairingCode,
  generateGuestCredentialSecret,
  normalizeAndValidatePairingCode,
  timingSafeDigestEqual,
} from "@/lib/session/crypto";
import { logSessionBackendEvent } from "@/lib/session/backend-log";
import { classifyDatabaseError, classifySupabaseFailure } from "@/lib/session/db-error";
import { SessionServiceError } from "@/lib/session/errors";
import { safeMessageForCode } from "@/lib/session/safe-errors";

/**
 * Loosely typed admin client surface. Domain validation happens with Zod at the edges.
 */
export type SessionAdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (relation: string) => any;
};

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

type StoredCredential = GuestCredential & { secretHmac: string };

const guestSessionRowSchema = z.object({
  id: z.string().uuid(),
  host_device_id: z.string().min(1),
  status: z.enum(["active", "ended"]),
  display_mode: displayModeSchema,
  seq: z.coerce.number().int().nonnegative(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  expires_at: z.string().min(1),
  closed_at: z.string().nullable(),
});

const deviceRowSchema = z.object({
  id: z.string().min(1),
  session_id: z.string().uuid(),
  device_id: z.string().min(1),
  role: deviceRoleSchema,
  label: z.string().nullable(),
  display_mode: displayModeSchema,
  last_seen_at: z.string().min(1),
  is_online: z.boolean(),
});

const playbackRowSchema = z.object({
  session_id: z.string().uuid(),
  audio_mode: z.string().min(1),
  is_playing: z.boolean(),
  position_ms: z.number(),
  rate: z.number(),
  track_id: z.string().min(1),
  seq: z.coerce.number().int().nonnegative(),
  updated_at: z.string().min(1),
});

const presetRowSchema = z.object({
  session_id: z.string().uuid(),
  visualizer_id: z.string().min(1),
  quality_tier: z.string().min(1),
  preset_id: z.string().nullable(),
  params: z.unknown(),
  seq: z.coerce.number().int().nonnegative(),
  updated_at: z.string().min(1),
});

const pairingRowSchema = z
  .object({
    id: z.string().min(1),
    session_id: z.string().uuid(),
    code_hash: z.string().regex(/^[a-f0-9]{64}$/),
    attempts: z.number().int().nonnegative(),
    max_attempts: z.number().int().positive(),
    expires_at: z.string().min(1),
    consumed_at: z.string().nullable(),
    revoked_at: z.string().nullable().optional(),
    created_at: z.string().min(1).optional(),
  })
  .strict();

const credentialRowSchema = z
  .object({
    session_id: z.string().uuid(),
    device_id: z.string().min(1),
    secret_hash: z.string().regex(/^[a-f0-9]{64}$/),
    role: deviceRoleSchema,
    expires_at: z.string().min(1),
    revoked_at: z.string().nullable().optional(),
    created_at: z.string().min(1).optional(),
  })
  .strict();

function nowIso(ms = Date.now()): string {
  return new Date(ms).toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function mintCredential(input: {
  sessionId: string;
  deviceId: string;
  role: DeviceRole;
}): GuestCredential & { secretHmac: string } {
  const secret = generateGuestCredentialSecret();
  const expiresAt = nowIso(Date.now() + GUEST_CREDENTIAL_TTL_MS);
  return {
    token: `${input.sessionId}.${input.deviceId}.${secret}`,
    sessionId: input.sessionId,
    deviceId: input.deviceId,
    role: input.role,
    expiresAt,
    secretHmac: digestGuestCredential(secret, getSessionSigningSecret()),
  };
}

export function publicIdentity(cred: GuestCredential): PublicGuestIdentity {
  return publicGuestIdentitySchema.parse({
    sessionId: cred.sessionId,
    deviceId: cred.deviceId,
    role: cred.role,
    expiresAt: cred.expiresAt,
  });
}

function asParams(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

const HMAC_HEX_RE = /^[a-f0-9]{64}$/;

const PLAINTEXT_PAIRING_KEYS = ["code", "code_hint", "plaintext_code", "pairing_code"] as const;

/** Post-hotfix pairing_codes insert. Omits `revoked_at` so a stale PostgREST cache (PGRST204) can still accept the row; Postgres defaults it to null. Never includes plaintext columns. */
export function buildPairingCodeInsert(input: {
  sessionId: string;
  codeHmac: string;
  expiresAt: string;
  createdAt: string;
}): {
  session_id: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: null;
  created_at: string;
} {
  if (!HMAC_HEX_RE.test(input.codeHmac)) {
    throw new SessionServiceError("schema_mismatch", safeMessageForCode("schema_mismatch"), 503);
  }
  const row = {
    session_id: input.sessionId,
    code_hash: input.codeHmac,
    attempts: 0,
    max_attempts: PAIRING_MAX_ATTEMPTS,
    expires_at: input.expiresAt,
    consumed_at: null,
    created_at: input.createdAt,
  };
  for (const key of PLAINTEXT_PAIRING_KEYS) {
    if (key in row) {
      throw new SessionServiceError("schema_mismatch", safeMessageForCode("schema_mismatch"), 503);
    }
  }
  return row;
}

function throwIfError(
  error: { message: string; code?: string | null } | null,
  operation: string,
  table?: string,
): void {
  if (error) {
    const category = classifySupabaseFailure(error);
    const sessionCode = classifyDatabaseError(error.message, error.code);
    logSessionBackendEvent({
      operation,
      table,
      category,
      code: sessionCode,
      pgCode: error.code ?? undefined,
    });
    throw new SessionServiceError(sessionCode, safeMessageForCode(sessionCode), 503);
  }
}

function parseToken(token: string): { sessionId: string; deviceId: string; secret: string } {
  const parts = token.split(".");
  if (parts.length < 3) {
    throw new SessionServiceError("unauthorized", "Unauthorized.", 401);
  }
  return {
    sessionId: parts[0]!,
    deviceId: parts[1]!,
    secret: parts.slice(2).join("."),
  };
}

async function loadSnapshot(
  client: SessionAdminClient,
  sessionId: string,
): Promise<SessionSnapshot> {
  const { data: session, error: sessionError } = await client
    .from("guest_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  throwIfError(sessionError, "Failed to load session.");
  if (!session) {
    throw new SessionServiceError("not_found", "Session not found.", 404);
  }
  const row = guestSessionRowSchema.parse(session);
  const expired = Date.parse(row.expires_at) < Date.now();
  if (row.status === "ended" || expired) {
    throw new SessionServiceError("ended", "Session has ended.", 410);
  }

  const [devicesRes, playbackRes, presetRes] = await Promise.all([
    client.from("session_devices").select("*").eq("session_id", sessionId),
    client.from("playback_state").select("*").eq("session_id", sessionId).maybeSingle(),
    client.from("active_preset_snapshots").select("*").eq("session_id", sessionId).maybeSingle(),
  ]);

  throwIfError(devicesRes.error, "Failed to load devices.");
  throwIfError(playbackRes.error, "Failed to load playback.");
  throwIfError(presetRes.error, "Failed to load preset.");
  if (!playbackRes.data || !presetRes.data) {
    throw new SessionServiceError("not_found", "Session snapshot incomplete.", 404);
  }

  const playback = playbackRowSchema.parse(playbackRes.data);
  const preset = presetRowSchema.parse(presetRes.data);
  const devices = z.array(deviceRowSchema).parse(devicesRes.data ?? []);

  return sessionSnapshotSchema.parse({
    session: {
      id: row.id,
      hostDeviceId: row.host_device_id,
      status: row.status,
      displayMode: row.display_mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      closedAt: row.closed_at,
      seq: Number(row.seq),
    },
    devices: devices.map((device) => ({
      id: device.id,
      sessionId: device.session_id,
      deviceId: device.device_id,
      role: device.role,
      label: device.label,
      displayMode: device.display_mode,
      lastSeenAt: device.last_seen_at,
      isOnline: device.is_online,
    })),
    playback: {
      audioMode: playback.audio_mode as SessionSnapshot["playback"]["audioMode"],
      isPlaying: playback.is_playing,
      positionMs: playback.position_ms,
      rate: playback.rate,
      trackId: playback.track_id,
      updatedAt: playback.updated_at,
      seq: Number(playback.seq),
    },
    preset: {
      visualizerId: preset.visualizer_id as SessionSnapshot["preset"]["visualizerId"],
      qualityTier: preset.quality_tier as SessionSnapshot["preset"]["qualityTier"],
      presetId: preset.preset_id,
      params: asParams(preset.params),
      updatedAt: preset.updated_at,
      seq: Number(preset.seq),
    },
  });
}

async function bumpSessionSeq(client: SessionAdminClient, sessionId: string): Promise<number> {
  const { data, error } = await client
    .from("guest_sessions")
    .select("seq")
    .eq("id", sessionId)
    .maybeSingle();
  throwIfError(error, "Failed to bump session seq.");
  if (!data) {
    throw new SessionServiceError("not_found", "Session not found.", 404);
  }
  const next = Number((data as { seq: number }).seq) + 1;
  const { error: updateError } = await client
    .from("guest_sessions")
    .update({ seq: next, updated_at: nowIso() })
    .eq("id", sessionId);
  throwIfError(updateError, "Failed to bump session seq.");
  return next;
}

export async function createGuestSessionDurable(
  client: SessionAdminClient,
  input: {
    hostDeviceId?: string;
    role?: DeviceRole;
    displayMode?: DisplayMode;
  },
): Promise<{
  snapshot: SessionSnapshot;
  credential: GuestCredential;
  pairingCode: string;
  pairingExpiresAt: string;
}> {
  const hostDeviceId = input.hostDeviceId ?? `dev_${randomBytes(8).toString("hex")}`;
  const role = input.role ?? "combined";
  const displayMode = input.displayMode ?? "mirror";
  const sessionId = newId();
  const deviceRowId = newId();
  const createdAt = nowIso();
  const expiresAt = nowIso(Date.now() + SESSION_TTL_MS);
  const pairingCode = generatePairingCode((size) => randomBytes(size));
  const pairingExpiresAt = nowIso(Date.now() + PAIRING_CODE_TTL_MS);
  const credential = mintCredential({ sessionId, deviceId: hostDeviceId, role });
  const spectrumParams = defaultParamsForVisualizer("spectrum");
  const codeHmac = digestPairingCode(pairingCode, getSessionSigningSecret());

  const { error: sessionError } = await client.from("guest_sessions").insert({
    id: sessionId,
    host_device_id: hostDeviceId,
    status: "active",
    display_mode: displayMode,
    seq: 1,
    created_at: createdAt,
    updated_at: createdAt,
    expires_at: expiresAt,
    closed_at: null,
  });
  throwIfError(sessionError, "Failed to create session.", "guest_sessions");

  const writes = await Promise.all([
    client.from("session_devices").insert({
      id: deviceRowId,
      session_id: sessionId,
      device_id: hostDeviceId,
      role,
      label: null,
      display_mode: displayMode,
      last_seen_at: createdAt,
      is_online: true,
    }),
    client.from("playback_state").insert({
      session_id: sessionId,
      audio_mode: "demo_track",
      is_playing: false,
      position_ms: 0,
      rate: 1,
      track_id: "demo-track",
      seq: 1,
      updated_at: createdAt,
    }),
    client.from("active_preset_snapshots").insert({
      session_id: sessionId,
      visualizer_id: "spectrum",
      quality_tier: "high",
      preset_id: "builtin-spectrum-calm",
      params: spectrumParams as Json,
      seq: 1,
      updated_at: createdAt,
    }),
    client.from("pairing_codes").insert(
      buildPairingCodeInsert({
        sessionId,
        codeHmac,
        expiresAt: pairingExpiresAt,
        createdAt,
      }),
    ),
    client.from("session_credentials").insert({
      session_id: sessionId,
      device_id: hostDeviceId,
      secret_hash: credential.secretHmac,
      role,
      expires_at: credential.expiresAt,
      created_at: createdAt,
    }),
  ]);

  const writeTables = [
    "session_devices",
    "playback_state",
    "active_preset_snapshots",
    "pairing_codes",
    "session_credentials",
  ] as const;
  const failedWriteIndex = writes.findIndex((result) => result.error);
  const writeError = (failedWriteIndex >= 0 ? writes[failedWriteIndex]?.error : undefined) as
    { message: string; code?: string | null } | undefined;
  if (writeError) {
    await client.from("guest_sessions").delete().eq("id", sessionId);
    const category = classifySupabaseFailure(writeError);
    const code = classifyDatabaseError(writeError.message, writeError.code);
    logSessionBackendEvent({
      operation: "createGuestSession.writes",
      table: writeTables[failedWriteIndex] ?? "guest_sessions",
      category,
      code,
      pgCode: writeError.code ?? undefined,
    });
    throw new SessionServiceError(code, safeMessageForCode(code), 503);
  }

  const snapshot = await loadSnapshot(client, sessionId);
  return {
    snapshot,
    credential,
    pairingCode,
    pairingExpiresAt,
  };
}

export async function authorizeCredentialDurable(
  client: SessionAdminClient,
  token: string,
): Promise<StoredCredential> {
  const parsed = parseToken(token);
  const secretHmac = digestGuestCredential(parsed.secret, getSessionSigningSecret());

  const { data: cred, error } = await client
    .from("session_credentials")
    .select("*")
    .eq("session_id", parsed.sessionId)
    .eq("device_id", parsed.deviceId)
    .maybeSingle();
  throwIfError(error, "Failed to authorize credential.");
  if (!cred) {
    throw new SessionServiceError("unauthorized", "Unauthorized.", 401);
  }
  const credRow = credentialRowSchema.parse(cred);
  if (
    !timingSafeDigestEqual(credRow.secret_hash, secretHmac) ||
    Date.parse(credRow.expires_at) < Date.now() ||
    credRow.revoked_at
  ) {
    throw new SessionServiceError("unauthorized", "Unauthorized.", 401);
  }

  const { data: session, error: sessionError } = await client
    .from("guest_sessions")
    .select("status, expires_at")
    .eq("id", parsed.sessionId)
    .maybeSingle();
  throwIfError(sessionError, "Failed to authorize credential.");
  const sessionRow = session as { status: string; expires_at: string } | null;
  if (!sessionRow) {
    throw new SessionServiceError("unauthorized", "Unauthorized.", 401);
  }
  if (sessionRow.status === "ended" || Date.parse(sessionRow.expires_at) < Date.now()) {
    throw new SessionServiceError("ended", "Session has ended.", 410);
  }

  return {
    token,
    sessionId: parsed.sessionId,
    deviceId: parsed.deviceId,
    role: credRow.role,
    expiresAt: credRow.expires_at,
    secretHmac: credRow.secret_hash,
  };
}

export async function getSnapshotForCredentialDurable(
  client: SessionAdminClient,
  token: string,
): Promise<SessionSnapshot> {
  const cred = await authorizeCredentialDurable(client, token);
  return loadSnapshot(client, cred.sessionId);
}

export async function heartbeatDurable(
  client: SessionAdminClient,
  token: string,
): Promise<SessionSnapshot> {
  const cred = await authorizeCredentialDurable(client, token);
  const now = nowIso();
  const { error } = await client
    .from("session_devices")
    .update({ last_seen_at: now, is_online: true })
    .eq("session_id", cred.sessionId)
    .eq("device_id", cred.deviceId);
  throwIfError(error, "Failed to heartbeat.");
  return getSnapshotForCredentialDurable(client, token);
}

export async function joinWithPairingCodeDurable(
  client: SessionAdminClient,
  input: {
    code: string;
    role?: DeviceRole;
    deviceId?: string;
    label?: string | null;
  },
): Promise<{ snapshot: SessionSnapshot; credential: GuestCredential }> {
  const normalized = normalizeAndValidatePairingCode(input.code);
  if (!normalized) {
    throw new SessionServiceError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }
  const candidateHmac = digestPairingCode(normalized, getSessionSigningSecret());

  const { data: matched, error: pairingError } = await client
    .from("pairing_codes")
    .select("*")
    .eq("code_hash", candidateHmac)
    .is("consumed_at", null)
    .is("revoked_at", null)
    .gt("expires_at", nowIso())
    .maybeSingle();
  throwIfError(pairingError, "Failed to look up pairing code.", "pairing_codes");

  if (!matched) {
    throw new SessionServiceError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }

  const matchedRow = pairingRowSchema.parse(matched);
  if (
    !timingSafeDigestEqual(matchedRow.code_hash, candidateHmac) ||
    matchedRow.attempts >= matchedRow.max_attempts
  ) {
    throw new SessionServiceError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }

  const nextAttempts = matchedRow.attempts + 1;
  if (nextAttempts > matchedRow.max_attempts) {
    await client.from("pairing_codes").update({ attempts: nextAttempts }).eq("id", matchedRow.id);
    throw new SessionServiceError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }

  const { data: session, error: sessionError } = await client
    .from("guest_sessions")
    .select("*")
    .eq("id", matchedRow.session_id)
    .maybeSingle();
  throwIfError(sessionError, "Failed to load session for join.");
  if (!session) {
    throw new SessionServiceError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }
  const sessionRow = guestSessionRowSchema.parse(session);
  if (sessionRow.status !== "active" || Date.parse(sessionRow.expires_at) < Date.now()) {
    throw new SessionServiceError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }

  const role = input.role ?? "display";
  const deviceId = input.deviceId ?? `dev_${randomBytes(8).toString("hex")}`;
  const now = nowIso();

  const { data: existingDevice } = await client
    .from("session_devices")
    .select("*")
    .eq("session_id", matchedRow.session_id)
    .eq("device_id", deviceId)
    .maybeSingle();
  const existing = existingDevice ? deviceRowSchema.parse(existingDevice) : null;

  if (existing) {
    const { error } = await client
      .from("session_devices")
      .update({
        role,
        is_online: true,
        last_seen_at: now,
        label: input.label ?? existing.label,
      })
      .eq("id", existing.id);
    throwIfError(error, "Failed to update device.");
  } else {
    const { error } = await client.from("session_devices").insert({
      id: newId(),
      session_id: matchedRow.session_id,
      device_id: deviceId,
      role,
      label: input.label ?? null,
      display_mode: sessionRow.display_mode,
      last_seen_at: now,
      is_online: true,
    });
    throwIfError(error, "Failed to insert device.");
  }

  await client.from("pairing_codes").update({ attempts: 0 }).eq("id", matchedRow.id);

  const credential = mintCredential({
    sessionId: matchedRow.session_id,
    deviceId,
    role,
  });
  const { error: credError } = await client.from("session_credentials").upsert({
    session_id: matchedRow.session_id,
    device_id: deviceId,
    secret_hash: credential.secretHmac,
    role,
    expires_at: credential.expiresAt,
    revoked_at: null,
    created_at: now,
  });
  throwIfError(credError, "Failed to mint credential.");

  await bumpSessionSeq(client, matchedRow.session_id);
  const snapshot = await loadSnapshot(client, matchedRow.session_id);
  return { snapshot, credential };
}

export async function rotatePairingCodeDurable(
  client: SessionAdminClient,
  token: string,
): Promise<{ pairingCode: string; pairingExpiresAt: string }> {
  const cred = await authorizeCredentialDurable(client, token);
  if (cred.role !== "controller" && cred.role !== "combined") {
    throw new SessionServiceError("unauthorized", "Only the controller can rotate codes.", 401);
  }

  const now = nowIso();
  await client
    .from("pairing_codes")
    .update({ consumed_at: now, revoked_at: now })
    .eq("session_id", cred.sessionId)
    .is("consumed_at", null);

  const pairingCode = generatePairingCode((size) => randomBytes(size));
  const pairingExpiresAt = nowIso(Date.now() + PAIRING_CODE_TTL_MS);
  const { error: insertError } = await client.from("pairing_codes").insert(
    buildPairingCodeInsert({
      sessionId: cred.sessionId,
      codeHmac: digestPairingCode(pairingCode, getSessionSigningSecret()),
      expiresAt: pairingExpiresAt,
      createdAt: now,
    }),
  );
  throwIfError(insertError, "Failed to rotate pairing code.", "pairing_codes");
  return { pairingCode, pairingExpiresAt };
}

export async function endSessionDurable(client: SessionAdminClient, token: string): Promise<void> {
  const cred = await authorizeCredentialDurable(client, token);
  if (cred.role !== "controller" && cred.role !== "combined") {
    throw new SessionServiceError("unauthorized", "Only the controller can end the session.", 401);
  }
  const now = nowIso();
  const { error } = await client
    .from("guest_sessions")
    .update({ status: "ended", closed_at: now, updated_at: now })
    .eq("id", cred.sessionId);
  throwIfError(error, "Failed to end session.");
  await client
    .from("session_devices")
    .update({ is_online: false })
    .eq("session_id", cred.sessionId);
  await client
    .from("pairing_codes")
    .update({ consumed_at: now, revoked_at: now })
    .eq("session_id", cred.sessionId)
    .is("consumed_at", null);
  await client
    .from("session_credentials")
    .update({ revoked_at: now })
    .eq("session_id", cred.sessionId)
    .is("revoked_at", null);
}

export async function handoffControllerDurable(
  client: SessionAdminClient,
  token: string,
  targetDeviceId: string,
): Promise<SessionSnapshot> {
  const cred = await authorizeCredentialDurable(client, token);
  if (cred.role !== "controller" && cred.role !== "combined") {
    throw new SessionServiceError("unauthorized", "Only the controller can hand off.", 401);
  }

  const { data: target, error: targetError } = await client
    .from("session_devices")
    .select("*")
    .eq("session_id", cred.sessionId)
    .eq("device_id", targetDeviceId)
    .maybeSingle();
  throwIfError(targetError, "Failed to load target device.");
  if (!target) {
    throw new SessionServiceError("not_found", "Target device not found.", 404);
  }

  const now = nowIso();
  const { data: devices, error: devicesError } = await client
    .from("session_devices")
    .select("*")
    .eq("session_id", cred.sessionId);
  throwIfError(devicesError, "Failed to load devices.");

  await Promise.all(
    z
      .array(deviceRowSchema)
      .parse(devices ?? [])
      .map((device) => {
        if (device.device_id === targetDeviceId) {
          return client
            .from("session_devices")
            .update({ role: "controller", last_seen_at: now })
            .eq("id", device.id);
        }
        if (device.role === "controller" || device.role === "combined") {
          return client
            .from("session_devices")
            .update({ role: "display", last_seen_at: now })
            .eq("id", device.id);
        }
        return Promise.resolve({ error: null });
      }),
  );

  await client
    .from("session_credentials")
    .update({ role: "display" })
    .eq("session_id", cred.sessionId)
    .eq("device_id", cred.deviceId);
  await client
    .from("session_credentials")
    .update({ role: "controller" })
    .eq("session_id", cred.sessionId)
    .eq("device_id", targetDeviceId);

  await bumpSessionSeq(client, cred.sessionId);
  return getSnapshotForCredentialDurable(client, token);
}

export async function publishAuthorizedMessageDurable(
  client: SessionAdminClient,
  token: string,
  message: SessionMessage,
): Promise<SessionMessage> {
  const cred = await authorizeCredentialDurable(client, token);
  if (message.sessionId !== cred.sessionId || message.deviceId !== cred.deviceId) {
    throw new SessionServiceError("unauthorized", "Unauthorized.", 401);
  }

  const controllerOnly = new Set([
    "playback.update",
    "preset.apply",
    "visual.intent",
    "display.mode",
    "session.patch",
    "handoff.request",
    "handoff.accept",
  ]);
  if (controllerOnly.has(message.type) && cred.role === "display") {
    throw new SessionServiceError("unauthorized", "Displays cannot publish control events.", 401);
  }

  const now = nowIso();
  const seq = await bumpSessionSeq(client, cred.sessionId);
  let stamped: SessionMessage = { ...message, seq, sentAt: now };

  switch (stamped.type) {
    case "ping": {
      const received = Date.now();
      return {
        type: "pong",
        seq: await bumpSessionSeq(client, cred.sessionId),
        sentAt: nowIso(received),
        sessionId: stamped.sessionId,
        deviceId: "server",
        payload: {
          clientSentAtMs: stamped.payload.clientSentAtMs,
          serverReceivedAtMs: received,
          serverSentAtMs: Date.now(),
        },
      };
    }
    case "playback.update": {
      const { error } = await client
        .from("playback_state")
        .update({
          audio_mode: stamped.payload.audioMode,
          is_playing: stamped.payload.isPlaying,
          position_ms: stamped.payload.positionMs,
          rate: stamped.payload.rate,
          track_id: stamped.payload.trackId,
          seq,
          updated_at: now,
        })
        .eq("session_id", cred.sessionId);
      throwIfError(error, "Failed to update playback.");
      break;
    }
    case "preset.apply": {
      const snapshot = await loadSnapshot(client, cred.sessionId);
      const nextPreset = mergeActivePresetSnapshot(snapshot.preset, stamped.payload, seq, now);
      const { error } = await client
        .from("active_preset_snapshots")
        .update({
          visualizer_id: nextPreset.visualizerId,
          quality_tier: nextPreset.qualityTier,
          preset_id: nextPreset.presetId,
          params: nextPreset.params as Json,
          seq,
          updated_at: now,
        })
        .eq("session_id", cred.sessionId);
      throwIfError(error, "Failed to apply preset.");
      stamped = { ...stamped, payload: nextPreset };
      break;
    }
    case "visual.intent": {
      const snapshot = await loadSnapshot(client, cred.sessionId);
      const nextPreset = mergeActivePresetSnapshot(snapshot.preset, stamped.payload, seq, now);
      const displayMode = stamped.payload.displayMode;
      const { error: presetError } = await client
        .from("active_preset_snapshots")
        .update({
          visualizer_id: nextPreset.visualizerId,
          quality_tier: nextPreset.qualityTier,
          preset_id: nextPreset.presetId,
          params: nextPreset.params as Json,
          seq,
          updated_at: now,
        })
        .eq("session_id", cred.sessionId);
      throwIfError(presetError, "Failed to update visual intent.");
      stamped = {
        ...stamped,
        payload: {
          ...stamped.payload,
          visualizerId: nextPreset.visualizerId,
          qualityTier: nextPreset.qualityTier,
          params: nextPreset.params,
        },
      };
      if (displayMode) {
        const { error } = await client
          .from("guest_sessions")
          .update({ display_mode: displayMode, updated_at: now, seq })
          .eq("id", cred.sessionId);
        throwIfError(error, "Failed to update display mode.");
      }
      break;
    }
    case "display.mode": {
      const { error } = await client
        .from("guest_sessions")
        .update({ display_mode: stamped.payload.displayMode, updated_at: now, seq })
        .eq("id", cred.sessionId);
      throwIfError(error, "Failed to update display mode.");
      break;
    }
    default:
      break;
  }

  return stamped;
}

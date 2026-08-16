import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  GUEST_CREDENTIAL_TTL_MS,
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  defaultParamsForVisualizer,
  type DeviceRole,
  type DisplayMode,
  type GuestCredential,
  type SessionMessage,
  type SessionSnapshot,
} from "@prism/contracts";
import type { Json } from "@prism/db";
import { generatePairingCode } from "@prism/sync-engine";

import { SessionServiceError } from "@/lib/session/errors";

/**
 * Loosely typed admin client surface. Supabase generated generics are brittle in this
 * monorepo's hand-written Database type; domain validation happens at the edges.
 */
export type SessionAdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (relation: string) => any;
};

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

type StoredCredential = GuestCredential & { secretHash: string };

type GuestSessionRow = {
  id: string;
  host_device_id: string;
  status: "active" | "ended";
  display_mode: DisplayMode;
  seq: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  closed_at: string | null;
};

type DeviceRow = {
  id: string;
  session_id: string;
  device_id: string;
  role: DeviceRole;
  label: string | null;
  display_mode: DisplayMode;
  last_seen_at: string;
  is_online: boolean;
};

type PlaybackRow = {
  session_id: string;
  audio_mode: string;
  is_playing: boolean;
  position_ms: number;
  rate: number;
  track_id: string;
  seq: number;
  updated_at: string;
};

type PresetRow = {
  session_id: string;
  visualizer_id: string;
  quality_tier: string;
  preset_id: string | null;
  params: Json;
  seq: number;
  updated_at: string;
};

type PairingRow = {
  id: string;
  session_id: string;
  code_hash: string;
  code_hint: string;
  code: string | null;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
};

type CredentialRow = {
  session_id: string;
  device_id: string;
  secret_hash: string;
  role: DeviceRole;
  expires_at: string;
};

function nowIso(ms = Date.now()): string {
  return new Date(ms).toISOString();
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function newId(): string {
  return crypto.randomUUID();
}

function mintCredential(input: {
  sessionId: string;
  deviceId: string;
  role: DeviceRole;
}): GuestCredential & { secret: string; secretHash: string } {
  const secret = randomBytes(24).toString("base64url");
  const expiresAt = nowIso(Date.now() + GUEST_CREDENTIAL_TTL_MS);
  return {
    token: `${input.sessionId}.${input.deviceId}.${secret}`,
    sessionId: input.sessionId,
    deviceId: input.deviceId,
    role: input.role,
    expiresAt,
    secret,
    secretHash: hashValue(secret),
  };
}

function publicCredential(cred: GuestCredential): GuestCredential {
  return {
    token: cred.token,
    sessionId: cred.sessionId,
    deviceId: cred.deviceId,
    role: cred.role,
    expiresAt: cred.expiresAt,
  };
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

function asParams(value: Json): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function throwIfError(error: { message: string } | null, fallback: string): void {
  if (error) {
    throw new SessionServiceError("backend_unavailable", error.message || fallback, 503);
  }
}

async function loadSnapshot(
  client: SessionAdminClient,
  sessionId: string,
  options?: { includePairing?: boolean; allowEnded?: boolean },
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
  const row = session as GuestSessionRow;
  const expired = Date.parse(row.expires_at) < Date.now();
  if (!options?.allowEnded && (row.status === "ended" || expired)) {
    throw new SessionServiceError("ended", "Session has ended.", 410);
  }

  const [devicesRes, playbackRes, presetRes, pairingRes] = await Promise.all([
    client.from("session_devices").select("*").eq("session_id", sessionId),
    client.from("playback_state").select("*").eq("session_id", sessionId).maybeSingle(),
    client.from("active_preset_snapshots").select("*").eq("session_id", sessionId).maybeSingle(),
    options?.includePairing
      ? client
          .from("pairing_codes")
          .select("*")
          .eq("session_id", sessionId)
          .is("consumed_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  throwIfError(devicesRes.error, "Failed to load devices.");
  throwIfError(playbackRes.error, "Failed to load playback.");
  throwIfError(presetRes.error, "Failed to load preset.");
  throwIfError(pairingRes.error, "Failed to load pairing.");
  if (!playbackRes.data || !presetRes.data) {
    throw new SessionServiceError("not_found", "Session snapshot incomplete.", 404);
  }

  const playback = playbackRes.data as PlaybackRow;
  const preset = presetRes.data as PresetRow;
  const devices = (devicesRes.data ?? []) as DeviceRow[];

  const snapshot: SessionSnapshot = {
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
  };

  if (options?.includePairing && pairingRes.data) {
    const pairing = pairingRes.data as PairingRow;
    if (pairing.code && !pairing.consumed_at && Date.parse(pairing.expires_at) >= Date.now()) {
      snapshot.pairingCode = pairing.code as SessionSnapshot["pairingCode"];
      snapshot.pairingExpiresAt = pairing.expires_at;
    }
  }

  return snapshot;
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
  throwIfError(sessionError, "Failed to create session.");

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
    client.from("pairing_codes").insert({
      session_id: sessionId,
      code_hash: hashValue(pairingCode),
      code_hint: pairingCode.slice(0, 2),
      code: pairingCode,
      attempts: 0,
      max_attempts: PAIRING_MAX_ATTEMPTS,
      expires_at: pairingExpiresAt,
      consumed_at: null,
      created_at: createdAt,
    }),
    client.from("session_credentials").insert({
      session_id: sessionId,
      device_id: hostDeviceId,
      secret_hash: credential.secretHash,
      role,
      expires_at: credential.expiresAt,
      created_at: createdAt,
    }),
  ]);

  const writeError = writes.find((result) => result.error)?.error as
    { message: string } | undefined;
  if (writeError) {
    await client.from("guest_sessions").delete().eq("id", sessionId);
    throw new SessionServiceError("backend_unavailable", writeError.message, 503);
  }

  const snapshot = await loadSnapshot(client, sessionId, { includePairing: true });
  return {
    snapshot,
    credential: publicCredential(credential),
    pairingCode,
    pairingExpiresAt,
  };
}

export async function authorizeCredentialDurable(
  client: SessionAdminClient,
  token: string,
): Promise<StoredCredential> {
  const parsed = parseToken(token);
  const secretHash = hashValue(parsed.secret);

  const { data: cred, error } = await client
    .from("session_credentials")
    .select("*")
    .eq("session_id", parsed.sessionId)
    .eq("device_id", parsed.deviceId)
    .maybeSingle();
  throwIfError(error, "Failed to authorize credential.");
  const credRow = cred as CredentialRow | null;
  if (
    !credRow ||
    !hashEqual(credRow.secret_hash, secretHash) ||
    Date.parse(credRow.expires_at) < Date.now()
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
    secretHash: credRow.secret_hash,
  };
}

export async function getSnapshotForCredentialDurable(
  client: SessionAdminClient,
  token: string,
): Promise<SessionSnapshot> {
  const cred = await authorizeCredentialDurable(client, token);
  const isController = cred.role === "controller" || cred.role === "combined";
  return loadSnapshot(client, cred.sessionId, { includePairing: isController });
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
  const normalized = input.code.trim().toUpperCase();
  const candidateHash = hashValue(normalized);

  const { data: matched, error: pairingError } = await client
    .from("pairing_codes")
    .select("*")
    .eq("code_hash", candidateHash)
    .is("consumed_at", null)
    .gt("expires_at", nowIso())
    .maybeSingle();
  throwIfError(pairingError, "Failed to look up pairing code.");

  const matchedRow = matched as PairingRow | null;
  if (!matchedRow || matchedRow.attempts >= matchedRow.max_attempts) {
    const { data: burn } = await client
      .from("pairing_codes")
      .select("id, attempts")
      .is("consumed_at", null)
      .gt("expires_at", nowIso())
      .limit(1)
      .maybeSingle();
    if (burn) {
      const burnRow = burn as { id: string; attempts: number };
      await client
        .from("pairing_codes")
        .update({ attempts: burnRow.attempts + 1 })
        .eq("id", burnRow.id);
    }
    throw new SessionServiceError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }

  if (matchedRow.code && matchedRow.code !== normalized) {
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
  const sessionRow = session as GuestSessionRow | null;
  if (
    !sessionRow ||
    sessionRow.status !== "active" ||
    Date.parse(sessionRow.expires_at) < Date.now()
  ) {
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
  const existing = existingDevice as DeviceRow | null;

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
    secret_hash: credential.secretHash,
    role,
    expires_at: credential.expiresAt,
    created_at: now,
  });
  throwIfError(credError, "Failed to mint credential.");

  await bumpSessionSeq(client, matchedRow.session_id);
  const snapshot = await loadSnapshot(client, matchedRow.session_id, { includePairing: false });
  return {
    snapshot,
    credential: publicCredential(credential),
  };
}

export async function rotatePairingCodeDurable(
  client: SessionAdminClient,
  sessionId: string,
  deviceId: string,
): Promise<{ pairingCode: string; pairingExpiresAt: string }> {
  const { data: cred, error } = await client
    .from("session_credentials")
    .select("*")
    .eq("session_id", sessionId)
    .eq("device_id", deviceId)
    .maybeSingle();
  throwIfError(error, "Failed to authorize rotation.");
  const credRow = cred as CredentialRow | null;
  if (!credRow || (credRow.role !== "controller" && credRow.role !== "combined")) {
    throw new SessionServiceError("unauthorized", "Only the controller can rotate codes.", 401);
  }

  const { data: session } = await client
    .from("guest_sessions")
    .select("status, expires_at")
    .eq("id", sessionId)
    .maybeSingle();
  const sessionRow = session as { status: string; expires_at: string } | null;
  if (
    !sessionRow ||
    sessionRow.status !== "active" ||
    Date.parse(sessionRow.expires_at) < Date.now()
  ) {
    throw new SessionServiceError("ended", "Session has ended.", 410);
  }

  const now = nowIso();
  await client
    .from("pairing_codes")
    .update({ consumed_at: now })
    .eq("session_id", sessionId)
    .is("consumed_at", null);

  const pairingCode = generatePairingCode((size) => randomBytes(size));
  const pairingExpiresAt = nowIso(Date.now() + PAIRING_CODE_TTL_MS);
  const { error: insertError } = await client.from("pairing_codes").insert({
    session_id: sessionId,
    code_hash: hashValue(pairingCode),
    code_hint: pairingCode.slice(0, 2),
    code: pairingCode,
    attempts: 0,
    max_attempts: PAIRING_MAX_ATTEMPTS,
    expires_at: pairingExpiresAt,
    consumed_at: null,
    created_at: now,
  });
  throwIfError(insertError, "Failed to rotate pairing code.");
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
    ((devices ?? []) as DeviceRow[]).map((device) => {
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
  const stamped: SessionMessage = { ...message, seq, sentAt: now };

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
      const { error } = await client
        .from("active_preset_snapshots")
        .update({
          visualizer_id: stamped.payload.visualizerId,
          quality_tier: stamped.payload.qualityTier,
          preset_id: stamped.payload.presetId,
          params: stamped.payload.params as Json,
          seq,
          updated_at: now,
        })
        .eq("session_id", cred.sessionId);
      throwIfError(error, "Failed to apply preset.");
      break;
    }
    case "visual.intent": {
      const snapshot = await loadSnapshot(client, cred.sessionId);
      const { error: presetError } = await client
        .from("active_preset_snapshots")
        .update({
          visualizer_id: stamped.payload.visualizerId ?? snapshot.preset.visualizerId,
          quality_tier: stamped.payload.qualityTier ?? snapshot.preset.qualityTier,
          params: (stamped.payload.params ?? snapshot.preset.params) as Json,
          seq,
          updated_at: now,
        })
        .eq("session_id", cred.sessionId);
      throwIfError(presetError, "Failed to update visual intent.");
      if (stamped.payload.displayMode) {
        const { error } = await client
          .from("guest_sessions")
          .update({ display_mode: stamped.payload.displayMode, updated_at: now, seq })
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

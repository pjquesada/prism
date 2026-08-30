import { randomBytes } from "node:crypto";

import {
  GUEST_CREDENTIAL_TTL_MS,
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  defaultParamsForVisualizer,
  mergeActivePresetSnapshot,
  publicGuestIdentitySchema,
  sessionSnapshotSchema,
  type DeviceRole,
  type DisplayMode,
  type AudioFeatureEnvelope,
  type FeaturePublishResponse,
  type FeatureReceiptBody,
  type FeatureReceiptResponse,
  type GuestCredential,
  type PublicGuestIdentity,
  type SessionMessage,
  type SessionSnapshot,
} from "@prism/contracts";
import { generatePairingCode } from "@prism/sync-engine";

import {
  buildFeatureBroadcastMessage,
  logFeatureTransportEvent,
  validateEnvelope,
  type StoredFeatureFrame,
  type StoredFeatureReceipt,
} from "@/lib/session/feature-transport";

import { getSessionSigningSecret } from "@/lib/session/config";
import {
  digestGuestCredential,
  digestPairingCode,
  generateGuestCredentialSecret,
  normalizeAndValidatePairingCode,
  timingSafeDigestEqual,
} from "@/lib/session/crypto";
import { SessionServiceError, type SessionErrorCode } from "@/lib/session/errors";

export type { SessionErrorCode };
export { SessionServiceError };

type StoredDevice = SessionSnapshot["devices"][number];

type StoredPairing = {
  codeHmac: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
};

type StoredCredential = GuestCredential & { secretHmac: string };

type StoredSession = {
  snapshot: SessionSnapshot;
  pairing: StoredPairing | null;
  credentials: Map<string, StoredCredential>;
  seq: number;
  lastFeatureFrameSeq: number;
  latestFeatureFrame: StoredFeatureFrame | null;
  displayReceipt: StoredFeatureReceipt | null;
  listeners: Set<(message: SessionMessage) => void>;
};

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

type GlobalStore = {
  sessions: Map<string, StoredSession>;
};

function getStore(): GlobalStore {
  const g = globalThis as typeof globalThis & { __prismSessionStore?: GlobalStore };
  if (!g.__prismSessionStore) {
    g.__prismSessionStore = { sessions: new Map() };
  }
  return g.__prismSessionStore;
}

function nowIso(ms = Date.now()): string {
  return new Date(ms).toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function nextSeq(session: StoredSession): number {
  session.seq += 1;
  session.snapshot.session.seq = session.seq;
  return session.seq;
}

function publish(session: StoredSession, message: SessionMessage): void {
  for (const listener of session.listeners) {
    try {
      listener(message);
    } catch {
      // ignore listener failures
    }
  }
}

function defaultSnapshot(input: {
  sessionId: string;
  hostDeviceId: string;
  role: DeviceRole;
  displayMode: DisplayMode;
}): SessionSnapshot {
  const createdAt = nowIso();
  const expiresAt = nowIso(Date.now() + SESSION_TTL_MS);
  const deviceRowId = newId();
  return sessionSnapshotSchema.parse({
    session: {
      id: input.sessionId,
      hostDeviceId: input.hostDeviceId,
      status: "active",
      displayMode: input.displayMode,
      createdAt,
      updatedAt: createdAt,
      expiresAt,
      closedAt: null,
      seq: 1,
    },
    devices: [
      {
        id: deviceRowId,
        sessionId: input.sessionId,
        deviceId: input.hostDeviceId,
        role: input.role,
        label: null,
        displayMode: input.displayMode,
        lastSeenAt: createdAt,
        isOnline: true,
      },
    ],
    playback: {
      audioMode: "demo_track",
      isPlaying: false,
      positionMs: 0,
      rate: 1,
      trackId: "demo-track",
      updatedAt: createdAt,
      seq: 1,
    },
    preset: {
      visualizerId: "spectrum",
      qualityTier: "high",
      presetId: "builtin-spectrum-calm",
      params: defaultParamsForVisualizer("spectrum"),
      updatedAt: createdAt,
      seq: 1,
    },
  });
}

function mintCredential(input: {
  sessionId: string;
  deviceId: string;
  role: DeviceRole;
}): StoredCredential {
  const secret = generateGuestCredentialSecret();
  const expiresAt = nowIso(Date.now() + GUEST_CREDENTIAL_TTL_MS);
  const signingSecret = getSessionSigningSecret();
  return {
    token: `${input.sessionId}.${input.deviceId}.${secret}`,
    sessionId: input.sessionId,
    deviceId: input.deviceId,
    role: input.role,
    expiresAt,
    secretHmac: digestGuestCredential(secret, signingSecret),
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

function getSessionOrThrow(sessionId: string): StoredSession {
  const session = getStore().sessions.get(sessionId);
  if (!session) {
    throw new SessionServiceError("not_found", "Session not found.", 404);
  }
  if (
    session.snapshot.session.status === "ended" ||
    Date.parse(session.snapshot.session.expiresAt) < Date.now()
  ) {
    session.snapshot.session.status = "ended";
    throw new SessionServiceError("ended", "Session has ended.", 410);
  }
  return session;
}

export function createGuestSession(input: {
  hostDeviceId?: string;
  role?: DeviceRole;
  displayMode?: DisplayMode;
}): {
  snapshot: SessionSnapshot;
  credential: GuestCredential;
  pairingCode: string;
  pairingExpiresAt: string;
} {
  const hostDeviceId = input.hostDeviceId ?? `dev_${randomBytes(8).toString("hex")}`;
  const role = input.role ?? "combined";
  const displayMode = input.displayMode ?? "mirror";
  const sessionId = newId();
  const snapshot = defaultSnapshot({ sessionId, hostDeviceId, role, displayMode });
  const code = generatePairingCode((size) => randomBytes(size));
  const pairingExpiresAt = nowIso(Date.now() + PAIRING_CODE_TTL_MS);
  const credential = mintCredential({ sessionId, deviceId: hostDeviceId, role });
  const signingSecret = getSessionSigningSecret();

  const stored: StoredSession = {
    snapshot,
    pairing: {
      codeHmac: digestPairingCode(code, signingSecret),
      attempts: 0,
      maxAttempts: PAIRING_MAX_ATTEMPTS,
      expiresAt: pairingExpiresAt,
      consumedAt: null,
      revokedAt: null,
    },
    credentials: new Map([[hostDeviceId, credential]]),
    seq: 1,
    lastFeatureFrameSeq: -1,
    latestFeatureFrame: null,
    displayReceipt: null,
    listeners: new Set(),
  };
  getStore().sessions.set(sessionId, stored);

  return {
    snapshot: stored.snapshot,
    credential,
    pairingCode: code,
    pairingExpiresAt,
  };
}

export function rotatePairingCode(token: string): {
  pairingCode: string;
  pairingExpiresAt: string;
} {
  const cred = authorizeCredential(token);
  if (cred.role !== "controller" && cred.role !== "combined") {
    throw new SessionServiceError("unauthorized", "Only the controller can rotate codes.", 401);
  }
  const session = getSessionOrThrow(cred.sessionId);
  const now = nowIso();
  if (session.pairing && !session.pairing.consumedAt) {
    session.pairing.consumedAt = now;
    session.pairing.revokedAt = now;
  }
  const code = generatePairingCode((size) => randomBytes(size));
  const pairingExpiresAt = nowIso(Date.now() + PAIRING_CODE_TTL_MS);
  session.pairing = {
    codeHmac: digestPairingCode(code, getSessionSigningSecret()),
    attempts: 0,
    maxAttempts: PAIRING_MAX_ATTEMPTS,
    expiresAt: pairingExpiresAt,
    consumedAt: null,
    revokedAt: null,
  };
  return { pairingCode: code, pairingExpiresAt };
}

export function joinWithPairingCode(input: {
  code: string;
  role?: DeviceRole;
  deviceId?: string;
  label?: string | null;
  ip?: string;
}): {
  snapshot: SessionSnapshot;
  credential: GuestCredential;
} {
  const normalized = normalizeAndValidatePairingCode(input.code);
  if (!normalized) {
    throw new SessionServiceError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }
  const candidateHmac = digestPairingCode(normalized, getSessionSigningSecret());

  let matched: StoredSession | null = null;
  for (const session of getStore().sessions.values()) {
    if (!session.pairing || session.pairing.consumedAt || session.pairing.revokedAt) continue;
    if (session.snapshot.session.status !== "active") continue;
    if (Date.parse(session.pairing.expiresAt) < Date.now()) continue;
    if (session.pairing.attempts >= session.pairing.maxAttempts) continue;
    if (timingSafeDigestEqual(session.pairing.codeHmac, candidateHmac)) {
      matched = session;
      break;
    }
  }

  if (!matched || !matched.pairing) {
    for (const session of getStore().sessions.values()) {
      if (
        session.pairing &&
        !session.pairing.consumedAt &&
        !session.pairing.revokedAt &&
        session.snapshot.session.status === "active"
      ) {
        session.pairing.attempts += 1;
        break;
      }
    }
    throw new SessionServiceError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }

  matched.pairing.attempts += 1;
  if (matched.pairing.attempts > matched.pairing.maxAttempts) {
    throw new SessionServiceError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }

  if (Date.parse(matched.pairing.expiresAt) < Date.now()) {
    throw new SessionServiceError("invalid_or_expired", "Invalid or expired pairing code.", 400);
  }

  const role = input.role ?? "display";
  const deviceId = input.deviceId ?? `dev_${randomBytes(8).toString("hex")}`;
  const now = nowIso();
  const existing = matched.snapshot.devices.find((d) => d.deviceId === deviceId);
  const device: StoredDevice = existing
    ? { ...existing, role, isOnline: true, lastSeenAt: now, label: input.label ?? existing.label }
    : {
        id: newId(),
        sessionId: matched.snapshot.session.id,
        deviceId,
        role,
        label: input.label ?? null,
        displayMode: matched.snapshot.session.displayMode,
        lastSeenAt: now,
        isOnline: true,
      };

  matched.snapshot.devices = existing
    ? matched.snapshot.devices.map((d) => (d.deviceId === deviceId ? device : d))
    : [...matched.snapshot.devices, device];
  matched.snapshot.session.updatedAt = now;
  matched.pairing.attempts = 0;

  const credential = mintCredential({
    sessionId: matched.snapshot.session.id,
    deviceId,
    role,
  });
  matched.credentials.set(deviceId, credential);

  const seq = nextSeq(matched);
  const joined: SessionMessage = {
    type: "device.joined",
    seq,
    sentAt: now,
    sessionId: matched.snapshot.session.id,
    deviceId,
    payload: device,
  };
  publish(matched, joined);

  return {
    snapshot: matched.snapshot,
    credential,
  };
}

export function authorizeCredential(token: string): StoredCredential {
  const parts = token.split(".");
  if (parts.length < 3) {
    throw new SessionServiceError("unauthorized", "Unauthorized.", 401);
  }
  const sessionId = parts[0]!;
  const deviceId = parts[1]!;
  const secret = parts.slice(2).join(".");
  const session = getStore().sessions.get(sessionId);
  if (!session) {
    throw new SessionServiceError("unauthorized", "Unauthorized.", 401);
  }
  const cred = session.credentials.get(deviceId);
  const candidateHmac = digestGuestCredential(secret, getSessionSigningSecret());
  if (
    !cred ||
    !timingSafeDigestEqual(cred.secretHmac, candidateHmac) ||
    Date.parse(cred.expiresAt) < Date.now()
  ) {
    throw new SessionServiceError("unauthorized", "Unauthorized.", 401);
  }
  if (session.snapshot.session.status === "ended") {
    throw new SessionServiceError("ended", "Session has ended.", 410);
  }
  return cred;
}

export function getSnapshotForCredential(token: string): SessionSnapshot {
  const cred = authorizeCredential(token);
  const session = getSessionOrThrow(cred.sessionId);
  return sessionSnapshotSchema.parse(session.snapshot);
}

export function heartbeat(token: string): SessionSnapshot {
  const cred = authorizeCredential(token);
  const session = getSessionOrThrow(cred.sessionId);
  const now = nowIso();
  session.snapshot.devices = session.snapshot.devices.map((d) =>
    d.deviceId === cred.deviceId ? { ...d, lastSeenAt: now, isOnline: true } : d,
  );
  return getSnapshotForCredential(token);
}

export function endSession(token: string): void {
  const cred = authorizeCredential(token);
  if (cred.role !== "controller" && cred.role !== "combined") {
    throw new SessionServiceError("unauthorized", "Only the controller can end the session.", 401);
  }
  const session = getSessionOrThrow(cred.sessionId);
  const now = nowIso();
  session.snapshot.session.status = "ended";
  session.snapshot.session.closedAt = now;
  session.snapshot.session.updatedAt = now;
  if (session.pairing) {
    session.pairing.consumedAt = session.pairing.consumedAt ?? now;
    session.pairing.revokedAt = now;
  }
  const seq = nextSeq(session);
  publish(session, {
    type: "error",
    seq,
    sentAt: now,
    sessionId: cred.sessionId,
    deviceId: cred.deviceId,
    payload: { code: "session_ended", message: "Session ended." },
  });
}

export function handoffController(token: string, targetDeviceId: string): SessionSnapshot {
  const cred = authorizeCredential(token);
  if (cred.role !== "controller" && cred.role !== "combined") {
    throw new SessionServiceError("unauthorized", "Only the controller can hand off.", 401);
  }
  const session = getSessionOrThrow(cred.sessionId);
  const target = session.snapshot.devices.find((d) => d.deviceId === targetDeviceId);
  if (!target) {
    throw new SessionServiceError("not_found", "Target device not found.", 404);
  }
  const now = nowIso();
  session.snapshot.devices = session.snapshot.devices.map((d) => {
    if (d.deviceId === targetDeviceId) return { ...d, role: "controller", lastSeenAt: now };
    if (d.role === "controller" || d.role === "combined") {
      return { ...d, role: "display", lastSeenAt: now };
    }
    return d;
  });
  const previous = session.credentials.get(cred.deviceId);
  if (previous) {
    session.credentials.set(cred.deviceId, { ...previous, role: "display" });
  }
  const targetCred = session.credentials.get(targetDeviceId);
  if (targetCred) {
    session.credentials.set(targetDeviceId, { ...targetCred, role: "controller" });
  }
  const seq = nextSeq(session);
  publish(session, {
    type: "handoff.accept",
    seq,
    sentAt: now,
    sessionId: cred.sessionId,
    deviceId: cred.deviceId,
    payload: { controllerDeviceId: targetDeviceId },
  });
  return getSnapshotForCredential(token);
}

export function publishAuthorizedMessage(token: string, message: SessionMessage): SessionMessage {
  const cred = authorizeCredential(token);
  const session = getSessionOrThrow(cred.sessionId);
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

  if (message.type === "audio.features") {
    throw new SessionServiceError(
      "invalid_request",
      "Use the /features endpoint for audio feature publication.",
      400,
    );
  }

  const seq = nextSeq(session);
  let stamped: SessionMessage = { ...message, seq, sentAt: now };

  switch (stamped.type) {
    case "ping": {
      const received = Date.now();
      publish(session, {
        type: "pong",
        seq: nextSeq(session),
        sentAt: nowIso(received),
        sessionId: stamped.sessionId,
        deviceId: "server",
        payload: {
          clientSentAtMs: stamped.payload.clientSentAtMs,
          serverReceivedAtMs: received,
          serverSentAtMs: Date.now(),
        },
      });
      break;
    }
    case "playback.update":
      session.snapshot.playback = { ...stamped.payload, seq };
      break;
    case "preset.apply":
      session.snapshot.preset = mergeActivePresetSnapshot(
        session.snapshot.preset,
        stamped.payload,
        seq,
        now,
      );
      stamped = { ...stamped, payload: session.snapshot.preset };
      break;
    case "visual.intent": {
      const nextPreset = mergeActivePresetSnapshot(
        session.snapshot.preset,
        stamped.payload,
        seq,
        now,
      );
      session.snapshot.preset = nextPreset;
      const displayMode = stamped.payload.displayMode;
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
        session.snapshot.session.displayMode = displayMode;
      }
      break;
    }
    case "display.mode":
      session.snapshot.session.displayMode = stamped.payload.displayMode;
      break;
    case "session.snapshot":
      session.snapshot = stamped.payload;
      break;
    default:
      break;
  }

  publish(session, stamped);
  return stamped;
}

async function broadcastFeatureFrame(
  session: StoredSession,
  message: SessionMessage,
): Promise<"sent" | "failed"> {
  try {
    publish(session, message);
    return "sent";
  } catch {
    return "failed";
  }
}

export async function publishSessionFeaturesMemory(
  token: string,
  envelope: AudioFeatureEnvelope,
): Promise<FeaturePublishResponse> {
  const cred = authorizeCredential(token);
  if (cred.role !== "controller" && cred.role !== "combined") {
    logFeatureTransportEvent({
      operation: "publishSessionFeatures",
      sessionId: cred.sessionId,
      category: "authorization",
      code: "display_publish_forbidden",
    });
    throw new SessionServiceError("unauthorized", "Displays cannot publish feature frames.", 401);
  }
  const session = getSessionOrThrow(cred.sessionId);
  try {
    validateEnvelope(envelope, session.lastFeatureFrameSeq);
  } catch (error) {
    const code = error instanceof SessionServiceError ? error.code : "invalid_request";
    logFeatureTransportEvent({
      operation: "publishSessionFeatures",
      sessionId: cred.sessionId,
      category: "validation",
      code,
      frameSeq: envelope.frameSeq,
    });
    throw error;
  }

  session.lastFeatureFrameSeq = envelope.frameSeq;
  session.latestFeatureFrame = {
    frameSeq: envelope.frameSeq,
    timestampMs: envelope.timestampMs,
    envelope,
  };

  const stamped = buildFeatureBroadcastMessage({
    sessionId: cred.sessionId,
    deviceId: cred.deviceId,
    envelope,
    sentAt: nowIso(),
  });
  const realtimeBroadcast = await broadcastFeatureFrame(session, stamped);
  logFeatureTransportEvent({
    operation: "publishSessionFeatures",
    sessionId: cred.sessionId,
    category: "accepted",
    code: "stored",
    frameSeq: envelope.frameSeq,
    transport: realtimeBroadcast,
  });
  return {
    accepted: true,
    frameSeq: envelope.frameSeq,
    durableFallback: "stored",
    realtimeBroadcast,
  };
}

export function getSessionFeaturesAfterMemory(
  token: string,
  afterSeq: number,
): StoredFeatureFrame | null {
  const cred = authorizeCredential(token);
  const session = getSessionOrThrow(cred.sessionId);
  const latest = session.latestFeatureFrame;
  if (!latest || latest.frameSeq <= afterSeq) return null;
  return latest;
}

export function recordFeatureReceiptMemory(
  token: string,
  body: FeatureReceiptBody,
): FeatureReceiptResponse {
  const cred = authorizeCredential(token);
  if (cred.role === "controller" || cred.role === "combined") {
    throw new SessionServiceError(
      "unauthorized",
      "Controllers cannot acknowledge display receipt.",
      401,
    );
  }
  getSessionOrThrow(cred.sessionId);
  const receipt: StoredFeatureReceipt = {
    deviceId: cred.deviceId,
    frameSeq: body.frameSeq,
    receivedAtMs: body.receivedAtMs,
    transport: body.transport,
  };
  const session = getSessionOrThrow(cred.sessionId);
  session.displayReceipt = receipt;
  logFeatureTransportEvent({
    operation: "recordFeatureReceipt",
    sessionId: cred.sessionId,
    category: "display_ack",
    code: "accepted",
    frameSeq: body.frameSeq,
    transport: body.transport,
  });
  return {
    accepted: true,
    frameSeq: body.frameSeq,
    transport: body.transport,
    receivedAtMs: body.receivedAtMs,
  };
}

export function getLatestFeatureReceiptMemory(token: string): StoredFeatureReceipt | null {
  const cred = authorizeCredential(token);
  const session = getSessionOrThrow(cred.sessionId);
  return session.displayReceipt;
}

export function subscribeSession(
  sessionId: string,
  listener: (message: SessionMessage) => void,
): () => void {
  const session = getStore().sessions.get(sessionId);
  if (!session) {
    throw new SessionServiceError("not_found", "Session not found.", 404);
  }
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
  };
}

export function inspectPairingStoreForTests(sessionId: string): StoredPairing | null {
  return getStore().sessions.get(sessionId)?.pairing ?? null;
}

export function inspectCredentialStoreForTests(
  sessionId: string,
  deviceId: string,
): { secretHmac: string; token?: undefined } | null {
  const cred = getStore().sessions.get(sessionId)?.credentials.get(deviceId);
  if (!cred) return null;
  return { secretHmac: cred.secretHmac };
}

export function resetSessionStoreForTests(): void {
  getStore().sessions.clear();
}

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
import { generatePairingCode } from "@prism/sync-engine";

export type SessionErrorCode =
  | "invalid_or_expired"
  | "rate_limited"
  | "unauthorized"
  | "ended"
  | "not_found"
  | "payload_too_large"
  | "forbidden_payload"
  | "backend_unavailable";

export class SessionServiceError extends Error {
  readonly code: SessionErrorCode;
  readonly status: number;

  constructor(code: SessionErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type StoredDevice = SessionSnapshot["devices"][number];

type StoredPairing = {
  code: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  consumedAt: string | null;
};

type StoredCredential = GuestCredential & { secret: string };

type StoredSession = {
  snapshot: SessionSnapshot;
  pairing: StoredPairing | null;
  credentials: Map<string, StoredCredential>;
  seq: number;
  listeners: Set<(message: SessionMessage) => void>;
};

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const JOIN_RATE_LIMIT = 20;
const JOIN_RATE_WINDOW_MS = 60_000;

type GlobalStore = {
  sessions: Map<string, StoredSession>;
  joinAttemptsByIp: Map<string, { count: number; windowStart: number }>;
};

function getStore(): GlobalStore {
  const g = globalThis as typeof globalThis & { __prismSessionStore?: GlobalStore };
  if (!g.__prismSessionStore) {
    g.__prismSessionStore = { sessions: new Map(), joinAttemptsByIp: new Map() };
  }
  if (!g.__prismSessionStore.joinAttemptsByIp) {
    g.__prismSessionStore.joinAttemptsByIp = new Map();
  }
  return g.__prismSessionStore;
}

function nowIso(ms = Date.now()): string {
  return new Date(ms).toISOString();
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
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
  return {
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
  };
}

function mintCredential(input: {
  sessionId: string;
  deviceId: string;
  role: DeviceRole;
}): StoredCredential {
  const secret = randomBytes(24).toString("base64url");
  const expiresAt = nowIso(Date.now() + GUEST_CREDENTIAL_TTL_MS);
  return {
    token: `${input.sessionId}.${input.deviceId}.${secret}`,
    sessionId: input.sessionId,
    deviceId: input.deviceId,
    role: input.role,
    expiresAt,
    secret,
  };
}

function publicCredential(cred: StoredCredential): GuestCredential {
  return {
    token: cred.token,
    sessionId: cred.sessionId,
    deviceId: cred.deviceId,
    role: cred.role,
    expiresAt: cred.expiresAt,
  };
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

function enforceJoinRateLimit(ip: string): void {
  const store = getStore();
  const now = Date.now();
  const entry = store.joinAttemptsByIp.get(ip) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > JOIN_RATE_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  store.joinAttemptsByIp.set(ip, entry);
  if (entry.count > JOIN_RATE_LIMIT) {
    throw new SessionServiceError("rate_limited", "Too many join attempts. Try again later.", 429);
  }
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

  const stored: StoredSession = {
    snapshot: {
      ...snapshot,
      pairingCode: code,
      pairingExpiresAt,
    },
    pairing: {
      code,
      codeHash: hashCode(code),
      attempts: 0,
      maxAttempts: PAIRING_MAX_ATTEMPTS,
      expiresAt: pairingExpiresAt,
      consumedAt: null,
    },
    credentials: new Map([[hostDeviceId, credential]]),
    seq: 1,
    listeners: new Set(),
  };
  getStore().sessions.set(sessionId, stored);

  return {
    snapshot: stored.snapshot,
    credential: publicCredential(credential),
    pairingCode: code,
    pairingExpiresAt,
  };
}

export function rotatePairingCode(
  sessionId: string,
  deviceId: string,
): {
  pairingCode: string;
  pairingExpiresAt: string;
} {
  const session = getSessionOrThrow(sessionId);
  const cred = session.credentials.get(deviceId);
  if (!cred || (cred.role !== "controller" && cred.role !== "combined")) {
    throw new SessionServiceError("unauthorized", "Only the controller can rotate codes.", 401);
  }
  const code = generatePairingCode((size) => randomBytes(size));
  const pairingExpiresAt = nowIso(Date.now() + PAIRING_CODE_TTL_MS);
  session.pairing = {
    code,
    codeHash: hashCode(code),
    attempts: 0,
    maxAttempts: PAIRING_MAX_ATTEMPTS,
    expiresAt: pairingExpiresAt,
    consumedAt: null,
  };
  session.snapshot.pairingCode = code;
  session.snapshot.pairingExpiresAt = pairingExpiresAt;
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
  const normalized = input.code.trim().toUpperCase();
  const ip = input.ip ?? "unknown";
  const candidateHash = hashCode(normalized);
  enforceJoinRateLimit(ip);

  // Scan active pairings without revealing which codes exist.
  let matched: StoredSession | null = null;
  for (const session of getStore().sessions.values()) {
    if (!session.pairing || session.pairing.consumedAt) continue;
    if (session.snapshot.session.status !== "active") continue;
    if (Date.parse(session.pairing.expiresAt) < Date.now()) continue;
    if (session.pairing.attempts >= session.pairing.maxAttempts) continue;
    if (hashEqual(session.pairing.codeHash, candidateHash)) {
      matched = session;
      break;
    }
  }

  if (!matched || !matched.pairing) {
    // Burn an attempt on a random active pairing when possible (anti-enumeration).
    for (const session of getStore().sessions.values()) {
      if (
        session.pairing &&
        !session.pairing.consumedAt &&
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
    snapshot: {
      ...matched.snapshot,
      pairingCode: undefined,
      pairingExpiresAt: undefined,
    },
    credential: publicCredential(credential),
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
  if (!cred || cred.secret !== secret || Date.parse(cred.expiresAt) < Date.now()) {
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
  const isController = cred.role === "controller" || cred.role === "combined";
  return {
    ...session.snapshot,
    pairingCode: isController ? session.snapshot.pairingCode : undefined,
    pairingExpiresAt: isController ? session.snapshot.pairingExpiresAt : undefined,
  };
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

  // Apply authoritative state for control messages
  const now = nowIso();
  const seq = nextSeq(session);
  const stamped: SessionMessage = { ...message, seq, sentAt: now };

  switch (stamped.type) {
    case "ping": {
      // Echo pong for clock sync samples.
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
      session.snapshot.preset = { ...stamped.payload, seq };
      break;
    case "visual.intent":
      session.snapshot.preset = {
        ...session.snapshot.preset,
        visualizerId: stamped.payload.visualizerId ?? session.snapshot.preset.visualizerId,
        qualityTier: stamped.payload.qualityTier ?? session.snapshot.preset.qualityTier,
        params: stamped.payload.params ?? session.snapshot.preset.params,
        updatedAt: now,
        seq,
      };
      if (stamped.payload.displayMode) {
        session.snapshot.session.displayMode = stamped.payload.displayMode;
      }
      break;
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

export function resetSessionStoreForTests(): void {
  const store = getStore();
  store.sessions.clear();
  store.joinAttemptsByIp.clear();
}

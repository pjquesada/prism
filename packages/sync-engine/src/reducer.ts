import {
  sessionMessageSchema,
  type DeviceRole,
  type DisplayMode,
  type SessionDevice,
  type SessionMessage,
  type SessionSnapshot,
} from "@prism/contracts";

import { createClockEstimate, type ClockEstimate } from "./clock.js";
import { createSeqState, decideSeq, type SeqState } from "./seq.js";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "unauthorized"
  | "ended"
  | "error";

export type SyncEngineState = {
  snapshot: SessionSnapshot | null;
  seq: SeqState;
  clock: ClockEstimate;
  connection: ConnectionStatus;
  localDeviceId: string | null;
  localRole: DeviceRole | null;
};

export function createSyncEngineState(localDeviceId?: string): SyncEngineState {
  return {
    snapshot: null,
    seq: createSeqState(0),
    clock: createClockEstimate(),
    connection: "idle",
    localDeviceId: localDeviceId ?? null,
    localRole: null,
  };
}

function upsertDevice(devices: SessionDevice[], device: SessionDevice): SessionDevice[] {
  const idx = devices.findIndex((d) => d.deviceId === device.deviceId);
  if (idx === -1) return [...devices, device];
  const next = [...devices];
  next[idx] = device;
  return next;
}

function setDeviceRole(
  devices: SessionDevice[],
  deviceId: string,
  role: DeviceRole,
): SessionDevice[] {
  return devices.map((d) => (d.deviceId === deviceId ? { ...d, role } : d));
}

function demoteControllers(devices: SessionDevice[], exceptDeviceId: string): SessionDevice[] {
  return devices.map((d) => {
    if (d.deviceId === exceptDeviceId) return { ...d, role: "controller" as const };
    if (d.role === "controller" || d.role === "combined") {
      return { ...d, role: "display" as const };
    }
    return d;
  });
}

export type ApplyResult = {
  state: SyncEngineState;
  applied: boolean;
  requestSnapshot: boolean;
};

export function applySessionMessage(state: SyncEngineState, raw: unknown): ApplyResult {
  const parsed = sessionMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return { state, applied: false, requestSnapshot: false };
  }
  const message = parsed.data;
  const decision = decideSeq(state.seq, message);

  if (decision.action === "ignore_stale") {
    return { state: { ...state, seq: decision.next }, applied: false, requestSnapshot: false };
  }
  if (decision.action === "request_snapshot") {
    return {
      state: { ...state, seq: decision.next },
      applied: false,
      requestSnapshot: true,
    };
  }

  const nextSeq = decision.next;
  const snap = state.snapshot;

  switch (message.type) {
    case "session.snapshot":
      return {
        state: {
          ...state,
          snapshot: message.payload,
          seq: nextSeq,
          connection: message.payload.session.status === "ended" ? "ended" : state.connection,
          localRole:
            message.payload.devices.find((d) => d.deviceId === state.localDeviceId)?.role ??
            state.localRole,
        },
        applied: true,
        requestSnapshot: false,
      };
    case "session.patch": {
      if (!snap) return { state, applied: false, requestSnapshot: true };
      const playback = message.payload.playback
        ? { ...snap.playback, ...message.payload.playback }
        : snap.playback;
      const preset = message.payload.preset
        ? { ...snap.preset, ...message.payload.preset }
        : snap.preset;
      const displayMode = message.payload.displayMode ?? snap.session.displayMode;
      return {
        state: {
          ...state,
          seq: nextSeq,
          snapshot: {
            ...snap,
            playback,
            preset,
            session: { ...snap.session, displayMode, seq: message.seq },
          },
        },
        applied: true,
        requestSnapshot: false,
      };
    }
    case "device.joined": {
      if (!snap) return { state, applied: false, requestSnapshot: true };
      return {
        state: {
          ...state,
          seq: nextSeq,
          snapshot: { ...snap, devices: upsertDevice(snap.devices, message.payload) },
        },
        applied: true,
        requestSnapshot: false,
      };
    }
    case "device.left": {
      if (!snap) return { state, applied: false, requestSnapshot: true };
      return {
        state: {
          ...state,
          seq: nextSeq,
          snapshot: {
            ...snap,
            devices: snap.devices.map((d) =>
              d.deviceId === message.payload.deviceId ? { ...d, isOnline: false } : d,
            ),
          },
        },
        applied: true,
        requestSnapshot: false,
      };
    }
    case "device.role": {
      if (!snap) return { state, applied: false, requestSnapshot: true };
      const devices = setDeviceRole(snap.devices, message.payload.deviceId, message.payload.role);
      return {
        state: {
          ...state,
          seq: nextSeq,
          snapshot: { ...snap, devices },
          localRole:
            message.payload.deviceId === state.localDeviceId
              ? message.payload.role
              : state.localRole,
        },
        applied: true,
        requestSnapshot: false,
      };
    }
    case "playback.update": {
      if (!snap) return { state, applied: false, requestSnapshot: true };
      return {
        state: {
          ...state,
          seq: nextSeq,
          snapshot: { ...snap, playback: message.payload },
        },
        applied: true,
        requestSnapshot: false,
      };
    }
    case "preset.apply": {
      if (!snap) return { state, applied: false, requestSnapshot: true };
      return {
        state: {
          ...state,
          seq: nextSeq,
          snapshot: { ...snap, preset: message.payload },
        },
        applied: true,
        requestSnapshot: false,
      };
    }
    case "visual.intent": {
      if (!snap) return { state, applied: false, requestSnapshot: true };
      return {
        state: {
          ...state,
          seq: nextSeq,
          snapshot: {
            ...snap,
            session: {
              ...snap.session,
              displayMode: message.payload.displayMode ?? snap.session.displayMode,
              seq: message.seq,
            },
            preset: {
              ...snap.preset,
              visualizerId: message.payload.visualizerId ?? snap.preset.visualizerId,
              qualityTier: message.payload.qualityTier ?? snap.preset.qualityTier,
              params: message.payload.params ?? snap.preset.params,
              updatedAt: message.sentAt,
              seq: message.seq,
            },
          },
        },
        applied: true,
        requestSnapshot: false,
      };
    }
    case "display.mode": {
      if (!snap) return { state, applied: false, requestSnapshot: true };
      return {
        state: {
          ...state,
          seq: nextSeq,
          snapshot: {
            ...snap,
            session: {
              ...snap.session,
              displayMode: message.payload.displayMode,
              seq: message.seq,
            },
          },
        },
        applied: true,
        requestSnapshot: false,
      };
    }
    case "handoff.accept": {
      if (!snap) return { state, applied: false, requestSnapshot: true };
      const devices = demoteControllers(snap.devices, message.payload.controllerDeviceId);
      return {
        state: {
          ...state,
          seq: nextSeq,
          snapshot: { ...snap, devices },
          localRole:
            state.localDeviceId === message.payload.controllerDeviceId
              ? "controller"
              : state.localDeviceId
                ? "display"
                : state.localRole,
        },
        applied: true,
        requestSnapshot: false,
      };
    }
    case "error": {
      if (message.payload.code === "session_ended") {
        return {
          state: { ...state, seq: nextSeq, connection: "ended" },
          applied: true,
          requestSnapshot: false,
        };
      }
      if (message.payload.code === "unauthorized") {
        return {
          state: { ...state, seq: nextSeq, connection: "unauthorized" },
          applied: true,
          requestSnapshot: false,
        };
      }
      return { state: { ...state, seq: nextSeq }, applied: true, requestSnapshot: false };
    }
    case "ping":
    case "pong":
    case "heartbeat":
    case "snapshot.request":
    case "handoff.request":
    case "audio.features":
      return { state: { ...state, seq: nextSeq }, applied: true, requestSnapshot: false };
    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

export function setConnectionStatus(
  state: SyncEngineState,
  connection: ConnectionStatus,
): SyncEngineState {
  return { ...state, connection };
}

export function setLocalIdentity(
  state: SyncEngineState,
  input: { deviceId: string; role: DeviceRole },
): SyncEngineState {
  return { ...state, localDeviceId: input.deviceId, localRole: input.role };
}

export function getDisplayMode(state: SyncEngineState): DisplayMode {
  return state.snapshot?.session.displayMode ?? "mirror";
}

export type { SessionMessage };

import type {
  DeviceRole,
  PublicGuestIdentity,
  SessionMessage,
  SessionSnapshot,
} from "@prism/contracts";
import { publicGuestIdentitySchema } from "@prism/contracts";
import {
  HEARTBEAT_INTERVAL_MS,
  PING_INTERVAL_MS,
  applySessionMessage,
  createSyncEngineState,
  sessionNowMs,
  setConnectionStatus,
  setLocalIdentity,
  type ConnectionStatus,
  type SyncEngineState,
} from "@prism/sync-engine";

const RESTORE_TIMEOUT_MS = 12_000;
const CONNECT_TIMEOUT_MS = 15_000;

type CreateHandlers = {
  onState: (state: SyncEngineState) => void;
};

function jsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      credentials: "same-origin",
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

export class SessionClient {
  private state: SyncEngineState;
  private readonly onState: (state: SyncEngineState) => void;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connectWatchTimer: number | null = null;
  private disposed = false;
  private identity: PublicGuestIdentity | null = null;
  private snapshotInFlight = false;

  constructor(handlers: CreateHandlers) {
    this.state = createSyncEngineState();
    this.onState = handlers.onState;
  }

  getState(): SyncEngineState {
    return this.state;
  }

  getSessionNowMs(): number {
    return sessionNowMs(this.state.clock);
  }

  getIdentity(): PublicGuestIdentity | null {
    return this.identity;
  }

  async create(input?: {
    role?: "controller" | "display" | "combined";
    displayMode?: "mirror" | "complementary";
  }): Promise<{
    snapshot: SessionSnapshot;
    credential: PublicGuestIdentity;
    pairingCode: string;
    pairingExpiresAt: string;
    joinUrl: string;
  }> {
    this.patchConnection("connecting");
    const res = await fetchWithTimeout(
      "/api/session",
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(input ?? { role: "combined" }),
      },
      CONNECT_TIMEOUT_MS,
    );
    const data = await res.json();
    if (!res.ok) {
      this.patchConnection(res.status === 401 ? "unauthorized" : "error");
      throw new Error(data?.error?.code ?? "create_failed");
    }
    this.identity = publicGuestIdentitySchema.parse(data.credential);
    this.state = setLocalIdentity(this.state, {
      deviceId: this.identity.deviceId,
      role: this.identity.role,
    });
    this.applyRaw({
      type: "session.snapshot",
      seq: data.snapshot.session.seq,
      sentAt: new Date().toISOString(),
      sessionId: data.snapshot.session.id,
      deviceId: this.identity.deviceId,
      payload: data.snapshot,
    });
    this.patchConnection("connected");
    this.startTimers();
    return data;
  }

  async join(input: {
    code: string;
    role?: "controller" | "display" | "combined";
    deviceId?: string;
  }): Promise<{ snapshot: SessionSnapshot; credential: PublicGuestIdentity }> {
    this.patchConnection("connecting");
    const res = await fetchWithTimeout(
      "/api/session/join",
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(input),
      },
      CONNECT_TIMEOUT_MS,
    );
    const data = await res.json();
    if (!res.ok) {
      const code = data?.error?.code as string | undefined;
      if (code === "invalid_or_expired") this.patchConnection("idle");
      else if (code === "unauthorized") this.patchConnection("unauthorized");
      else this.patchConnection("error");
      throw new Error(code ?? "join_failed");
    }
    this.identity = publicGuestIdentitySchema.parse(data.credential);
    this.state = setLocalIdentity(this.state, {
      deviceId: this.identity.deviceId,
      role: this.identity.role,
    });
    this.applyRaw({
      type: "session.snapshot",
      seq: data.snapshot.session.seq,
      sentAt: new Date().toISOString(),
      sessionId: data.snapshot.session.id,
      deviceId: this.identity.deviceId,
      payload: data.snapshot,
    });
    this.patchConnection("connected");
    this.startTimers();
    return data;
  }

  /** Restore from the session-scoped HttpOnly cookie. No pairing code, no localStorage. */
  async restoreWithCookie(sessionId: string): Promise<void> {
    this.patchConnection("connecting");
    this.armConnectWatch();
    try {
      const res = await fetchWithTimeout(
        `/api/session/${sessionId}`,
        { headers: jsonHeaders() },
        RESTORE_TIMEOUT_MS,
      );
      const data = await res.json();
      if (!res.ok) {
        const status = res.status === 410 ? "ended" : res.status === 401 ? "unauthorized" : "error";
        this.patchConnection(status);
        throw new Error(data?.error?.code ?? "restore_failed");
      }
      const deviceId = data?.device?.deviceId as string | undefined;
      if (!deviceId) {
        this.patchConnection("unauthorized");
        throw new Error("unauthorized");
      }
      const role =
        (data.device?.role as DeviceRole | undefined) ??
        (data.snapshot.devices.find(
          (d: { deviceId: string; role: DeviceRole }) => d.deviceId === deviceId,
        )?.role as DeviceRole | undefined) ??
        "display";
      this.identity = {
        sessionId,
        deviceId,
        role,
        expiresAt:
          (data.device?.expiresAt as string | undefined) ??
          new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
      this.state = setLocalIdentity(this.state, { deviceId, role });
      this.applySnapshotPayload(data.snapshot, deviceId);
      this.patchConnection("connected");
      this.startTimers();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        this.patchConnection("error");
        throw new Error("restore_timeout");
      }
      if (this.state.connection === "connecting") {
        this.patchConnection("error");
      }
      throw error;
    } finally {
      this.clearConnectWatch();
    }
  }

  async rotatePairingCode(): Promise<{
    pairingCode: string;
    pairingExpiresAt: string;
    joinUrl: string;
  }> {
    if (!this.identity) throw new Error("unauthorized");
    const res = await fetchWithTimeout(
      `/api/session/${this.identity.sessionId}/pairing`,
      { method: "POST", headers: jsonHeaders() },
      CONNECT_TIMEOUT_MS,
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.code ?? "rotate_failed");
    }
    return data;
  }

  async publish(
    message: Omit<SessionMessage, "seq" | "sentAt"> & { seq?: number; sentAt?: string },
  ): Promise<void> {
    if (!this.identity) throw new Error("unauthorized");
    const body = {
      message: {
        ...message,
        seq: message.seq ?? 0,
        sentAt: message.sentAt ?? new Date().toISOString(),
      },
    };
    const res = await fetch(`/api/session/${this.identity.sessionId}/broadcast`, {
      method: "POST",
      credentials: "same-origin",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.code ?? "broadcast_failed");
    }
    if (data?.message) {
      this.applyRaw(data.message);
    }
  }

  async end(): Promise<void> {
    if (!this.identity) return;
    await fetch(`/api/session/${this.identity.sessionId}/end`, {
      method: "POST",
      credentials: "same-origin",
      headers: jsonHeaders(),
    });
    this.patchConnection("ended");
    this.dispose();
  }

  async handoff(targetDeviceId: string): Promise<void> {
    if (!this.identity) throw new Error("unauthorized");
    const res = await fetch(`/api/session/${this.identity.sessionId}/handoff`, {
      method: "POST",
      credentials: "same-origin",
      headers: jsonHeaders(),
      body: JSON.stringify({ targetDeviceId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error?.code ?? "handoff_failed");
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearConnectWatch();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private applySnapshotPayload(snapshot: SessionSnapshot, deviceId: string): void {
    this.applyRaw({
      type: "session.snapshot",
      seq: snapshot.session.seq,
      sentAt: new Date().toISOString(),
      sessionId: snapshot.session.id,
      deviceId,
      payload: snapshot,
    });
  }

  private async requestSnapshot(): Promise<void> {
    if (!this.identity || this.snapshotInFlight) return;
    this.snapshotInFlight = true;
    try {
      const res = await fetch(`/api/session/${this.identity.sessionId}`, {
        credentials: "same-origin",
        headers: jsonHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      this.applySnapshotPayload(data.snapshot, this.identity.deviceId);
      this.patchConnection("connected");
    } catch {
      this.patchConnection("offline");
    } finally {
      this.snapshotInFlight = false;
    }
  }

  private startTimers(): void {
    if (!this.identity) return;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);

    this.pollTimer = setInterval(() => {
      void this.requestSnapshot();
    }, 1_000);

    this.heartbeatTimer = setInterval(() => {
      if (!this.identity) return;
      void fetch(`/api/session/${this.identity.sessionId}`, {
        method: "POST",
        credentials: "same-origin",
        headers: jsonHeaders(),
      })
        .then(async (res) => {
          if (res.status === 410) {
            this.patchConnection("ended");
            return;
          }
          if (!res.ok) {
            this.patchConnection("reconnecting");
            return;
          }
          const data = await res.json();
          if (data?.snapshot) {
            this.applySnapshotPayload(data.snapshot, this.identity!.deviceId);
            this.patchConnection("connected");
          }
        })
        .catch(() => {
          this.patchConnection("offline");
        });
    }, HEARTBEAT_INTERVAL_MS);

    this.pingTimer = setInterval(() => {
      if (!this.identity || !this.state.snapshot) return;
      const clientSentAtMs = Date.now();
      void this.publish({
        type: "ping",
        sessionId: this.identity.sessionId,
        deviceId: this.identity.deviceId,
        payload: { clientSentAtMs },
      }).catch(() => {
        // ignore
      });
    }, PING_INTERVAL_MS);
  }

  private applyRaw(raw: unknown): { requestSnapshot: boolean } {
    const result = applySessionMessage(this.state, raw);
    this.state = result.state;
    this.emit();
    return { requestSnapshot: result.requestSnapshot };
  }

  private patchConnection(connection: ConnectionStatus): void {
    this.state = setConnectionStatus(this.state, connection);
    this.emit();
  }

  private armConnectWatch(): void {
    this.clearConnectWatch();
    this.connectWatchTimer = window.setTimeout(() => {
      if (this.disposed) return;
      if (this.state.connection === "connecting" && !this.state.snapshot) {
        this.patchConnection("error");
      }
    }, CONNECT_TIMEOUT_MS);
  }

  private clearConnectWatch(): void {
    if (this.connectWatchTimer) {
      window.clearTimeout(this.connectWatchTimer);
      this.connectWatchTimer = null;
    }
  }

  private emit(): void {
    this.onState(this.state);
  }
}

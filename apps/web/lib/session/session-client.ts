import type {
  DeviceRole,
  GuestCredential,
  SessionMessage,
  SessionSnapshot,
} from "@prism/contracts";
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

export type SessionTransportKind = "memory" | "supabase";

const RESTORE_TIMEOUT_MS = 12_000;
const CONNECT_TIMEOUT_MS = 15_000;

type CreateHandlers = {
  onState: (state: SyncEngineState) => void;
};

function authHeaders(token: string | null | undefined): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
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
  private eventSource: EventSource | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connectWatchTimer: number | null = null;
  private disposed = false;
  private credential: GuestCredential | null = null;
  private transport: SessionTransportKind = "memory";
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

  async create(input?: {
    role?: "controller" | "display" | "combined";
    displayMode?: "mirror" | "complementary";
  }): Promise<{
    snapshot: SessionSnapshot;
    credential: GuestCredential;
    pairingCode: string;
    pairingExpiresAt: string;
    joinUrl: string;
  }> {
    this.patchConnection("connecting");
    const res = await fetchWithTimeout(
      "/api/session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input ?? { role: "combined" }),
      },
      CONNECT_TIMEOUT_MS,
    );
    const data = await res.json();
    if (!res.ok) {
      this.patchConnection(res.status === 401 ? "unauthorized" : "offline");
      throw new Error(data?.error?.code ?? "create_failed");
    }
    this.transport = data.transport === "supabase" ? "supabase" : "memory";
    this.credential = data.credential;
    this.state = setLocalIdentity(this.state, {
      deviceId: data.credential.deviceId,
      role: data.credential.role,
    });
    this.applyRaw({
      type: "session.snapshot",
      seq: data.snapshot.session.seq,
      sentAt: new Date().toISOString(),
      sessionId: data.snapshot.session.id,
      deviceId: data.credential.deviceId,
      payload: data.snapshot,
    });
    this.patchConnection("connected");
    this.connectEvents();
    this.startTimers();
    return data;
  }

  async join(input: {
    code: string;
    role?: "controller" | "display" | "combined";
    deviceId?: string;
  }): Promise<{ snapshot: SessionSnapshot; credential: GuestCredential }> {
    this.patchConnection("connecting");
    const res = await fetchWithTimeout(
      "/api/session/join",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      CONNECT_TIMEOUT_MS,
    );
    const data = await res.json();
    if (!res.ok) {
      const code = data?.error?.code as string | undefined;
      if (code === "invalid_or_expired") this.patchConnection("idle");
      else if (code === "unauthorized") this.patchConnection("unauthorized");
      else this.patchConnection("offline");
      throw new Error(code ?? "join_failed");
    }
    this.transport = data.transport === "supabase" ? "supabase" : "memory";
    this.credential = data.credential;
    this.state = setLocalIdentity(this.state, {
      deviceId: data.credential.deviceId,
      role: data.credential.role,
    });
    this.applyRaw({
      type: "session.snapshot",
      seq: data.snapshot.session.seq,
      sentAt: new Date().toISOString(),
      sessionId: data.snapshot.session.id,
      deviceId: data.credential.deviceId,
      payload: data.snapshot,
    });
    this.patchConnection("connected");
    this.connectEvents();
    this.startTimers();
    return data;
  }

  async restore(credential: GuestCredential): Promise<void> {
    this.credential = credential;
    this.state = setLocalIdentity(this.state, {
      deviceId: credential.deviceId,
      role: credential.role,
    });
    this.patchConnection("connecting");
    this.armConnectWatch();
    try {
      const res = await fetchWithTimeout(
        `/api/session/${credential.sessionId}`,
        { headers: authHeaders(credential.token) },
        RESTORE_TIMEOUT_MS,
      );
      const data = await res.json();
      if (!res.ok) {
        this.patchConnection(res.status === 410 ? "ended" : "unauthorized");
        throw new Error(data?.error?.code ?? "restore_failed");
      }
      this.applySnapshotPayload(data.snapshot, credential.deviceId);
      this.patchConnection("connected");
      this.connectEvents();
      this.startTimers();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        this.patchConnection("offline");
        throw new Error("restore_timeout");
      }
      throw error;
    } finally {
      this.clearConnectWatch();
    }
  }

  /** Cookie-only restore when localStorage/sessionStorage handoff is missing. */
  async restoreWithCookie(sessionId: string): Promise<void> {
    this.patchConnection("connecting");
    this.armConnectWatch();
    try {
      const res = await fetchWithTimeout(
        `/api/session/${sessionId}`,
        { headers: { "Content-Type": "application/json" } },
        RESTORE_TIMEOUT_MS,
      );
      const data = await res.json();
      if (!res.ok) {
        this.patchConnection(res.status === 410 ? "ended" : "unauthorized");
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
      this.credential = {
        token: "",
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
      this.connectEvents();
      this.startTimers();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        this.patchConnection("offline");
        throw new Error("restore_timeout");
      }
      throw error;
    } finally {
      this.clearConnectWatch();
    }
  }

  async publish(
    message: Omit<SessionMessage, "seq" | "sentAt"> & { seq?: number; sentAt?: string },
  ): Promise<void> {
    if (!this.credential) throw new Error("unauthorized");
    const body = {
      message: {
        ...message,
        seq: message.seq ?? 0,
        sentAt: message.sentAt ?? new Date().toISOString(),
      },
    };
    const res = await fetch(`/api/session/${this.credential.sessionId}/broadcast`, {
      method: "POST",
      credentials: "same-origin",
      headers: authHeaders(this.credential.token || null),
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
    if (!this.credential) return;
    await fetch(`/api/session/${this.credential.sessionId}/end`, {
      method: "POST",
      credentials: "same-origin",
      headers: authHeaders(this.credential.token || null),
    });
    this.patchConnection("ended");
    this.dispose();
  }

  async handoff(targetDeviceId: string): Promise<void> {
    if (!this.credential) throw new Error("unauthorized");
    const res = await fetch(`/api/session/${this.credential.sessionId}/handoff`, {
      method: "POST",
      credentials: "same-origin",
      headers: authHeaders(this.credential.token || null),
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
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
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

  private connectEvents(): void {
    if (!this.credential || this.disposed) return;
    // Both memory and durable supabase transports use HTTP snapshot polling.
    // SSE fanout is single-process only and unsafe across Vercel isolates.
    return;
  }

  private async requestSnapshot(): Promise<void> {
    if (!this.credential || this.snapshotInFlight) return;
    this.snapshotInFlight = true;
    try {
      const res = await fetch(`/api/session/${this.credential.sessionId}`, {
        credentials: "same-origin",
        headers: authHeaders(this.credential.token || null),
      });
      if (!res.ok) return;
      const data = await res.json();
      this.applySnapshotPayload(data.snapshot, this.credential.deviceId);
      this.patchConnection("connected");
    } catch {
      this.patchConnection("offline");
    } finally {
      this.snapshotInFlight = false;
    }
  }

  private startTimers(): void {
    if (!this.credential) return;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);

    this.pollTimer = setInterval(() => {
      void this.requestSnapshot();
    }, 1_000);

    this.heartbeatTimer = setInterval(() => {
      if (!this.credential) return;
      void fetch(`/api/session/${this.credential.sessionId}`, {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(this.credential.token || null),
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
            this.applySnapshotPayload(data.snapshot, this.credential!.deviceId);
            this.patchConnection("connected");
          }
        })
        .catch(() => {
          this.patchConnection("offline");
        });
    }, HEARTBEAT_INTERVAL_MS);

    this.pingTimer = setInterval(() => {
      if (!this.credential || !this.state.snapshot) return;
      const clientSentAtMs = Date.now();
      void this.publish({
        type: "ping",
        sessionId: this.credential.sessionId,
        deviceId: this.credential.deviceId,
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
        this.patchConnection("offline");
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

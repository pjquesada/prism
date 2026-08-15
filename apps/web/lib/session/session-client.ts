import type { GuestCredential, SessionMessage, SessionSnapshot } from "@prism/contracts";
import {
  HEARTBEAT_INTERVAL_MS,
  PING_INTERVAL_MS,
  applyPongSample,
  applySessionMessage,
  createSyncEngineState,
  sessionNowMs,
  setConnectionStatus,
  setLocalIdentity,
  type ConnectionStatus,
  type SyncEngineState,
} from "@prism/sync-engine";

export type SessionTransportKind = "memory" | "supabase";

type CreateHandlers = {
  onState: (state: SyncEngineState) => void;
};

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export class SessionClient {
  private state: SyncEngineState;
  private readonly onState: (state: SyncEngineState) => void;
  private eventSource: EventSource | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private credential: GuestCredential | null = null;
  private transport: SessionTransportKind = "memory";

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
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? { role: "combined" }),
    });
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
    const res = await fetch("/api/session/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
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
    const res = await fetch(`/api/session/${credential.sessionId}`, {
      headers: authHeaders(credential.token),
    });
    const data = await res.json();
    if (!res.ok) {
      this.patchConnection(res.status === 410 ? "ended" : "unauthorized");
      throw new Error(data?.error?.code ?? "restore_failed");
    }
    this.applyRaw({
      type: "session.snapshot",
      seq: data.snapshot.session.seq,
      sentAt: new Date().toISOString(),
      sessionId: data.snapshot.session.id,
      deviceId: credential.deviceId,
      payload: data.snapshot,
    });
    this.patchConnection("connected");
    this.connectEvents();
    this.startTimers();
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
      headers: authHeaders(this.credential.token),
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
      headers: authHeaders(this.credential.token),
    });
    this.patchConnection("ended");
    this.dispose();
  }

  async handoff(targetDeviceId: string): Promise<void> {
    if (!this.credential) throw new Error("unauthorized");
    const res = await fetch(`/api/session/${this.credential.sessionId}/handoff`, {
      method: "POST",
      headers: authHeaders(this.credential.token),
      body: JSON.stringify({ targetDeviceId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error?.code ?? "handoff_failed");
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private connectEvents(): void {
    if (!this.credential || this.disposed) return;
    if (this.transport === "memory") {
      // Memory backend uses snapshot polling (SSE is unreliable across Next.js production workers).
      return;
    }
    if (this.transport === "supabase") {
      // Supabase Realtime channel wiring is activated when env is configured.
    }
    const url = `/api/session/${this.credential.sessionId}/events?token=${encodeURIComponent(this.credential.token)}`;
    if (this.eventSource) this.eventSource.close();
    const es = new EventSource(url);
    this.eventSource = es;

    es.addEventListener("snapshot", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        this.applyRaw(data);
        this.patchConnection("connected");
      } catch {
        // ignore malformed
      }
    });

    es.addEventListener("message", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (data?.type === "pong") {
          this.state = {
            ...this.state,
            clock: applyPongSample(this.state.clock, {
              clientSentAtMs: data.payload.clientSentAtMs,
              serverReceivedAtMs: data.payload.serverReceivedAtMs,
              serverSentAtMs: data.payload.serverSentAtMs,
              clientReceivedAtMs: Date.now(),
            }),
          };
          this.emit();
          return;
        }
        const result = this.applyRaw(data);
        if (result.requestSnapshot) {
          void this.requestSnapshot();
        }
      } catch {
        // ignore malformed
      }
    });

    es.onerror = () => {
      if (this.disposed) return;
      this.patchConnection("reconnecting");
      es.close();
      window.setTimeout(() => {
        if (!this.disposed) this.connectEvents();
      }, 2_500);
    };
  }

  private snapshotInFlight = false;

  private async requestSnapshot(): Promise<void> {
    if (!this.credential || this.snapshotInFlight) return;
    this.snapshotInFlight = true;
    try {
      const res = await fetch(`/api/session/${this.credential.sessionId}`, {
        headers: authHeaders(this.credential.token),
      });
      if (!res.ok) return;
      const data = await res.json();
      this.applyRaw({
        type: "session.snapshot",
        seq: data.snapshot.session.seq,
        sentAt: new Date().toISOString(),
        sessionId: data.snapshot.session.id,
        deviceId: this.credential.deviceId,
        payload: data.snapshot,
      });
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

    // Memory transport: poll snapshot for multi-tab sync without SSE fanout storms.
    this.pollTimer = setInterval(
      () => {
        void this.requestSnapshot();
      },
      this.transport === "memory" ? 1_000 : 5_000,
    );

    this.heartbeatTimer = setInterval(() => {
      if (!this.credential) return;
      void fetch(`/api/session/${this.credential.sessionId}`, {
        method: "POST",
        headers: authHeaders(this.credential.token),
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
            this.applyRaw({
              type: "session.snapshot",
              seq: data.snapshot.session.seq,
              sentAt: new Date().toISOString(),
              sessionId: data.snapshot.session.id,
              deviceId: this.credential!.deviceId,
              payload: data.snapshot,
            });
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

  private emit(): void {
    this.onState(this.state);
  }
}

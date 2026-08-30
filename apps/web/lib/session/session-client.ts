import type {
  AudioFeatureEnvelope,
  DeviceRole,
  FeatureDeliveryTransport,
  FeaturePublishResponse,
  PublicGuestIdentity,
  RealtimeChannelState,
  SessionMessage,
  SessionSnapshot,
} from "@prism/contracts";
import {
  AUDIO_FEATURE_ENVELOPE_MAX_BYTES,
  featurePublishResponseSchema,
  publicGuestIdentitySchema,
  sessionMessageSchema,
} from "@prism/contracts";
import { acquireResource, getResourceCounts } from "@prism/audio-engine";
import { noteFeatureMessage, registerPerfResourceSource } from "@prism/visual-engine";
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

import { createOptionalBrowserSupabase } from "@/lib/supabase/browser";
import {
  FEATURE_ACK_INTERVAL_MS,
  FEATURE_FALLBACK_POLL_FAST_MS,
  FEATURE_PUBLISH_MIN_INTERVAL_MS,
  FEATURE_REALTIME_HEALTHY_MS,
  FEATURE_RECEIPT_POLL_MS,
  FeatureTransportMetrics,
  type FeaturePublishOutcome,
  type FeatureTransportDiagnostics,
} from "@/lib/session/feature-transport-metrics";

const RESTORE_TIMEOUT_MS = 12_000;
const CONNECT_TIMEOUT_MS = 15_000;
const SNAPSHOT_POLL_INTERVAL_MS = 10_000;
/** Skip snapshot polling while SSE/Supabase delivered a message this recently. */
export const REALTIME_HEALTHY_MS = 8_000;

registerPerfResourceSource(getResourceCounts);

export function shouldPollSnapshot(lastRealtimeEventAt: number, nowMs = Date.now()): boolean {
  if (lastRealtimeEventAt <= 0) return true;
  return nowMs - lastRealtimeEventAt >= REALTIME_HEALTHY_MS;
}

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
  private eventSource: EventSource | null = null;
  private supabaseChannel: { unsubscribe: () => void } | null = null;
  private realtimeStartedFor: string | null = null;
  private readonly featureListeners = new Set<(envelope: AudioFeatureEnvelope) => void>();
  private pendingFeature: AudioFeatureEnvelope | null = null;
  private featureFlushActive = false;
  private lastFeaturePublishMs = 0;
  private readonly featureMetrics = new FeatureTransportMetrics();
  private featureFallbackTimer: ReturnType<typeof setInterval> | null = null;
  private featureAckTimer: ReturnType<typeof setInterval> | null = null;
  private featureReceiptPollTimer: ReturnType<typeof setInterval> | null = null;
  private liveFeatureConsumption = false;
  private lastIngestedFrameSeq = -1;
  private lastAckFrameSeq = -1;
  private lastAckSentMs = 0;
  private realtimeChannelState: RealtimeChannelState = "idle";
  private lastRealtimeFeatureAtMs = 0;
  private transport: "memory" | "supabase" | null = null;
  private lastRealtimeEventAt = 0;
  private realtimeRelease: (() => void) | null = null;

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
      const code = (data?.error?.code as string | undefined) ?? "create_failed";
      if (code === "unauthorized") this.patchConnection("unauthorized");
      else if (
        code === "server_misconfigured" ||
        code === "configuration_error" ||
        code === "session_backend_unavailable" ||
        code === "database_unavailable" ||
        code === "schema_mismatch" ||
        code === "constraint_violation" ||
        code === "backend_unavailable"
      ) {
        this.patchConnection("idle");
      } else {
        this.patchConnection("error");
      }
      throw new Error(code);
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
    this.transport =
      data?.transport === "supabase" || data?.transport === "memory"
        ? data.transport
        : this.transport;
    this.startTimers();
    this.startRealtime();
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
    this.transport =
      data?.transport === "supabase" || data?.transport === "memory"
        ? data.transport
        : this.transport;
    this.startTimers();
    this.startRealtime();
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
      this.transport =
        data?.transport === "supabase" || data?.transport === "memory"
          ? data.transport
          : this.transport;
      this.patchConnection("connected");
      this.startTimers();
      this.startRealtime();
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
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `/api/session/${this.identity.sessionId}/broadcast`,
        {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify(body),
        },
        CONNECT_TIMEOUT_MS,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("broadcast_timeout");
      }
      throw new Error("broadcast_failed");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.code ?? "broadcast_failed");
    }
    if (data?.message) {
      this.applyRaw(data.message);
    }
  }

  getFeatureTransportDiagnostics(): FeatureTransportDiagnostics {
    this.featureMetrics.tick();
    return { ...this.featureMetrics.diagnostics };
  }

  getRealtimeChannelState(): RealtimeChannelState {
    return this.realtimeChannelState;
  }

  setLiveFeatureConsumption(enabled: boolean): void {
    if (this.liveFeatureConsumption === enabled) return;
    this.liveFeatureConsumption = enabled;
    if (enabled) {
      this.startFeatureFallbackLoop();
      this.startFeatureAckLoop();
    } else {
      this.stopFeatureFallbackLoop();
      this.stopFeatureAckLoop();
    }
  }

  setControllerReceiptPolling(enabled: boolean): void {
    if (enabled) this.startReceiptPollLoop();
    else this.stopReceiptPollLoop();
  }

  subscribeFeatures(listener: (envelope: AudioFeatureEnvelope) => void): () => void {
    this.featureListeners.add(listener);
    return () => {
      this.featureListeners.delete(listener);
    };
  }

  publishFeatures(envelope: AudioFeatureEnvelope): Promise<FeaturePublishOutcome> {
    if (!this.identity) {
      return Promise.resolve({ ok: false, errorCategory: "unauthorized", status: 401 });
    }
    return new Promise((resolve) => {
      this.featurePublishWaiters.set(envelope.frameSeq, resolve);
      this.pendingFeature = envelope;
      void this.scheduleFeatureFlush();
    });
  }

  private featurePublishWaiters = new Map<number, (outcome: FeaturePublishOutcome) => void>();

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
    this.stopRealtime();
    this.stopFeatureFallbackLoop();
    this.stopFeatureAckLoop();
    this.stopReceiptPollLoop();
    this.featureListeners.clear();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private scheduleFeatureFlush(): void {
    if (this.featureFlushActive) return;
    this.featureFlushActive = true;
    void this.runFeatureFlushLoop().finally(() => {
      this.featureFlushActive = false;
      if (this.pendingFeature) void this.scheduleFeatureFlush();
    });
  }

  private async runFeatureFlushLoop(): Promise<void> {
    while (this.pendingFeature && this.identity && !this.disposed) {
      const envelope = this.pendingFeature;
      this.pendingFeature = null;
      const encoded = new TextEncoder().encode(JSON.stringify(envelope));
      if (encoded.byteLength > AUDIO_FEATURE_ENVELOPE_MAX_BYTES) continue;
      const now = Date.now();
      const waitMs = FEATURE_PUBLISH_MIN_INTERVAL_MS - (now - this.lastFeaturePublishMs);
      if (waitMs > 0) await new Promise((resolve) => window.setTimeout(resolve, waitMs));
      const outcome = await this.publishFeatureEnvelope(envelope);
      const waiter = this.featurePublishWaiters.get(envelope.frameSeq);
      if (waiter) {
        waiter(outcome);
        this.featurePublishWaiters.delete(envelope.frameSeq);
      }
      this.lastFeaturePublishMs = Date.now();
    }
  }

  private async publishFeatureEnvelope(
    envelope: AudioFeatureEnvelope,
  ): Promise<FeaturePublishOutcome> {
    if (!this.identity) return { ok: false, errorCategory: "unauthorized", status: 401 };
    this.featureMetrics.notePublicationAttempt();
    try {
      const res = await fetchWithTimeout(
        `/api/session/${this.identity.sessionId}/features`,
        {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ envelope }),
        },
        CONNECT_TIMEOUT_MS,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const category = (data?.error?.code as string | undefined) ?? `http_${res.status}`;
        this.featureMetrics.notePublicationFailure(category);
        return { ok: false, errorCategory: category, status: res.status };
      }
      const parsed = featurePublishResponseSchema.parse(data) as FeaturePublishResponse;
      if (parsed.accepted) {
        this.featureMetrics.notePublicationAccepted();
        return { ok: true as const, response: parsed };
      }
      this.featureMetrics.notePublicationFailure(parsed.errorCategory ?? "rejected");
      return {
        ok: false,
        errorCategory: parsed.errorCategory ?? "rejected",
        status: res.status,
      };
    } catch {
      this.featureMetrics.notePublicationFailure("network_error");
      return { ok: false, errorCategory: "network_error", status: 0 };
    }
  }

  private startFeatureFallbackLoop(): void {
    if (this.featureFallbackTimer) return;
    const tick = () => {
      if (!this.identity || this.disposed || !this.liveFeatureConsumption) return;
      if (this.identity.role === "controller" || this.identity.role === "combined") return;
      const realtimeHealthy =
        this.realtimeChannelState === "SUBSCRIBED" &&
        Date.now() - this.lastRealtimeFeatureAtMs < FEATURE_REALTIME_HEALTHY_MS;
      if (realtimeHealthy) return;
      void this.pollFeatureFallback();
    };
    this.featureFallbackTimer = setInterval(tick, FEATURE_FALLBACK_POLL_FAST_MS);
  }

  private stopFeatureFallbackLoop(): void {
    if (this.featureFallbackTimer) clearInterval(this.featureFallbackTimer);
    this.featureFallbackTimer = null;
  }

  private async pollFeatureFallback(): Promise<void> {
    if (!this.identity) return;
    this.featureMetrics.noteFallbackPoll();
    try {
      const res = await fetch(
        `/api/session/${this.identity.sessionId}/features?afterSeq=${this.lastIngestedFrameSeq}`,
        { credentials: "same-origin", headers: jsonHeaders() },
      );
      if (res.status === 204) return;
      if (!res.ok) return;
      const data = (await res.json()) as { envelope: AudioFeatureEnvelope; frameSeq: number };
      if (data.frameSeq <= this.lastIngestedFrameSeq) return;
      this.ingestFeatureEnvelope(data.envelope, "fallback");
    } catch {
      // ignore transient fallback errors
    }
  }

  private startFeatureAckLoop(): void {
    if (this.featureAckTimer) return;
    this.featureAckTimer = setInterval(() => {
      void this.sendFeatureAckIfNeeded();
    }, FEATURE_ACK_INTERVAL_MS);
  }

  private stopFeatureAckLoop(): void {
    if (this.featureAckTimer) clearInterval(this.featureAckTimer);
    this.featureAckTimer = null;
  }

  private async sendFeatureAckIfNeeded(): Promise<void> {
    if (!this.identity || this.lastIngestedFrameSeq <= this.lastAckFrameSeq) return;
    const now = Date.now();
    if (now - this.lastAckSentMs < FEATURE_ACK_INTERVAL_MS) return;
    const transport = this.featureMetrics.diagnostics.deliveryPath;
    if (transport !== "realtime" && transport !== "fallback") return;
    this.lastAckSentMs = now;
    this.lastAckFrameSeq = this.lastIngestedFrameSeq;
    try {
      await fetch(`/api/session/${this.identity.sessionId}/features/receipt`, {
        method: "POST",
        credentials: "same-origin",
        headers: jsonHeaders(),
        body: JSON.stringify({
          frameSeq: this.lastIngestedFrameSeq,
          receivedAtMs: now,
          transport,
        }),
      });
    } catch {
      // ignore ack failures
    }
  }

  private startReceiptPollLoop(): void {
    if (this.featureReceiptPollTimer) return;
    this.featureReceiptPollTimer = setInterval(() => {
      void this.pollDisplayReceipt();
    }, FEATURE_RECEIPT_POLL_MS);
  }

  private stopReceiptPollLoop(): void {
    if (this.featureReceiptPollTimer) clearInterval(this.featureReceiptPollTimer);
    this.featureReceiptPollTimer = null;
  }

  private async pollDisplayReceipt(): Promise<void> {
    if (!this.identity) return;
    try {
      const res = await fetch(`/api/session/${this.identity.sessionId}/features/receipt`, {
        credentials: "same-origin",
        headers: jsonHeaders(),
      });
      if (res.status === 204) return;
      if (!res.ok) return;
      const data = (await res.json()) as {
        frameSeq: number;
        receivedAtMs: number;
        transport: FeatureDeliveryTransport;
      };
      this.featureMetrics.setDisplayAck(data);
    } catch {
      // ignore
    }
  }

  private ingestFeatureEnvelope(
    envelope: AudioFeatureEnvelope,
    transport: FeatureDeliveryTransport,
  ): void {
    if (envelope.frameSeq <= this.lastIngestedFrameSeq) return;
    this.lastIngestedFrameSeq = envelope.frameSeq;
    if (transport === "realtime") {
      this.featureMetrics.noteRealtimeEnvelope(envelope.frameSeq);
      this.lastRealtimeFeatureAtMs = Date.now();
    } else {
      this.featureMetrics.noteFallbackEnvelope(envelope.frameSeq);
    }
    this.emitFeatureToListeners(envelope);
  }

  private startRealtime(): void {
    if (!this.identity || this.disposed) return;
    if (this.realtimeStartedFor === this.identity.sessionId) return;
    this.stopRealtime();
    this.realtimeStartedFor = this.identity.sessionId;
    this.realtimeRelease = acquireResource("realtimeSubscriptions");
    if (this.transport !== "supabase") {
      this.startEventSource(this.identity.sessionId);
    }
    if (this.transport === "supabase") {
      this.startSupabaseChannel(this.identity.sessionId);
    }
  }

  private stopRealtime(): void {
    this.realtimeStartedFor = null;
    this.realtimeRelease?.();
    this.realtimeRelease = null;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.supabaseChannel) {
      this.supabaseChannel.unsubscribe();
      this.supabaseChannel = null;
    }
  }

  private startEventSource(sessionId: string): void {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/session/${sessionId}/events`, {
      withCredentials: true,
    });
    this.eventSource = source;
    this.setRealtimeChannelState("SUBSCRIBED");
    const onPayload = (event: MessageEvent<string>) => {
      try {
        this.applyRaw(JSON.parse(event.data) as unknown, "realtime");
      } catch {
        // ignore malformed SSE
      }
    };
    source.addEventListener("message", onPayload);
    source.addEventListener("snapshot", onPayload);
    source.onerror = () => {
      if (this.disposed) return;
      if (this.transport === "supabase") {
        source.close();
        this.eventSource = null;
      }
    };
  }

  private startSupabaseChannel(sessionId: string): void {
    const supabase = createOptionalBrowserSupabase();
    if (!supabase) {
      this.setRealtimeChannelState("idle");
      return;
    }
    this.setRealtimeChannelState("subscribing");
    const channel = supabase.channel(`session:${sessionId}`);
    channel.on("broadcast", { event: "session-message" }, (event) => {
      const payload =
        event && typeof event === "object" && "payload" in event
          ? (event as { payload?: unknown }).payload
          : event;
      this.applyRaw(payload, "realtime");
    });
    void channel.subscribe((status) => {
      if (status === "SUBSCRIBED") this.setRealtimeChannelState("SUBSCRIBED");
      else if (status === "CHANNEL_ERROR") this.setRealtimeChannelState("CHANNEL_ERROR");
      else if (status === "TIMED_OUT") this.setRealtimeChannelState("TIMED_OUT");
      else if (status === "CLOSED") this.setRealtimeChannelState("CLOSED");
      else if (status === "SUBSCRIBING") this.setRealtimeChannelState("subscribing");
    });
    this.supabaseChannel = {
      unsubscribe: () => {
        void supabase.removeChannel(channel);
        this.setRealtimeChannelState("CLOSED");
      },
    };
  }

  private setRealtimeChannelState(state: RealtimeChannelState): void {
    this.realtimeChannelState = state;
    this.featureMetrics.setChannelState(state);
  }

  private emitFeatureToListeners(envelope: AudioFeatureEnvelope): void {
    noteFeatureMessage();
    for (const listener of this.featureListeners) {
      listener(envelope);
    }
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
      if (!shouldPollSnapshot(this.lastRealtimeEventAt)) return;
      void this.requestSnapshot();
    }, SNAPSHOT_POLL_INTERVAL_MS);

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

  private applyRaw(
    raw: unknown,
    source: "local" | "realtime" = "local",
  ): { requestSnapshot: boolean } {
    if (source === "realtime") {
      this.lastRealtimeEventAt = Date.now();
    }
    const parsed = sessionMessageSchema.safeParse(raw);
    if (parsed.success && parsed.data.type === "audio.features") {
      this.ingestFeatureEnvelope(parsed.data.payload, "realtime");
      return { requestSnapshot: false };
    }
    const result = applySessionMessage(this.state, raw);
    this.state = result.state;
    this.emit();
    if (result.requestSnapshot) {
      void this.requestSnapshot();
    }
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

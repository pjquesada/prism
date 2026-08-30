import type {
  FeatureDeliveryPath,
  FeatureDeliveryTransport,
  FeaturePublishResponse,
  RealtimeChannelState,
} from "@prism/contracts";

export const FEATURE_PUBLISH_MIN_INTERVAL_MS = 50;
export const FEATURE_FALLBACK_POLL_FAST_MS = 100;
export const FEATURE_FALLBACK_POLL_SLOW_MS = 200;
export const FEATURE_REALTIME_HEALTHY_MS = 1_500;
export const FEATURE_ACK_INTERVAL_MS = 1_000;
export const FEATURE_RECEIPT_POLL_MS = 2_000;

export type FeatureTransportDiagnostics = {
  publicationAttemptsPerSecond: number;
  serverAcceptedPerSecond: number;
  publicationFailuresPerSecond: number;
  lastPublicationErrorCategory: string | null;
  realtimeChannelState: RealtimeChannelState;
  realtimeEnvelopesReceivedPerSecond: number;
  fallbackPollsPerSecond: number;
  fallbackEnvelopesReceivedPerSecond: number;
  lastReceivedFrameSeq: number;
  msSinceLastDisplayReceipt: number | null;
  deliveryPath: FeatureDeliveryPath;
  lastDisplayAckFrameSeq: number | null;
  lastDisplayAckAtMs: number | null;
  lastDisplayAckTransport: FeatureDeliveryTransport | null;
};

export function createFeatureTransportDiagnostics(): FeatureTransportDiagnostics {
  return {
    publicationAttemptsPerSecond: 0,
    serverAcceptedPerSecond: 0,
    publicationFailuresPerSecond: 0,
    lastPublicationErrorCategory: null,
    realtimeChannelState: "idle",
    realtimeEnvelopesReceivedPerSecond: 0,
    fallbackPollsPerSecond: 0,
    fallbackEnvelopesReceivedPerSecond: 0,
    lastReceivedFrameSeq: -1,
    msSinceLastDisplayReceipt: null,
    deliveryPath: "none",
    lastDisplayAckFrameSeq: null,
    lastDisplayAckAtMs: null,
    lastDisplayAckTransport: null,
  };
}

type RateCounter = {
  count: number;
  windowStartMs: number;
};

function bumpRate(counter: RateCounter, nowMs: number): number {
  const elapsed = nowMs - counter.windowStartMs;
  if (elapsed >= 1000) {
    const rate = (counter.count * 1000) / Math.max(1, elapsed);
    counter.count = 1;
    counter.windowStartMs = nowMs;
    return rate;
  }
  counter.count += 1;
  return (counter.count * 1000) / Math.max(1, nowMs - counter.windowStartMs);
}

export class FeatureTransportMetrics {
  readonly diagnostics = createFeatureTransportDiagnostics();
  private readonly publishAttempts = { count: 0, windowStartMs: Date.now() };
  private readonly publishAccepted = { count: 0, windowStartMs: Date.now() };
  private readonly publishFailures = { count: 0, windowStartMs: Date.now() };
  private readonly realtimeReceived = { count: 0, windowStartMs: Date.now() };
  private readonly fallbackPolls = { count: 0, windowStartMs: Date.now() };
  private readonly fallbackReceived = { count: 0, windowStartMs: Date.now() };
  private lastDisplayReceiptAtMs: number | null = null;

  notePublicationAttempt(nowMs = Date.now()): void {
    this.diagnostics.publicationAttemptsPerSecond = bumpRate(this.publishAttempts, nowMs);
  }

  notePublicationAccepted(nowMs = Date.now()): void {
    this.diagnostics.serverAcceptedPerSecond = bumpRate(this.publishAccepted, nowMs);
    this.diagnostics.lastPublicationErrorCategory = null;
  }

  notePublicationFailure(category: string, nowMs = Date.now()): void {
    this.diagnostics.publicationFailuresPerSecond = bumpRate(this.publishFailures, nowMs);
    this.diagnostics.lastPublicationErrorCategory = category;
  }

  noteRealtimeEnvelope(frameSeq: number, nowMs = Date.now()): void {
    this.diagnostics.realtimeEnvelopesReceivedPerSecond = bumpRate(this.realtimeReceived, nowMs);
    this.diagnostics.lastReceivedFrameSeq = frameSeq;
    this.lastDisplayReceiptAtMs = nowMs;
    this.diagnostics.msSinceLastDisplayReceipt = 0;
    this.diagnostics.deliveryPath = "realtime";
  }

  noteFallbackPoll(nowMs = Date.now()): void {
    this.diagnostics.fallbackPollsPerSecond = bumpRate(this.fallbackPolls, nowMs);
  }

  noteFallbackEnvelope(frameSeq: number, nowMs = Date.now()): void {
    this.diagnostics.fallbackEnvelopesReceivedPerSecond = bumpRate(this.fallbackReceived, nowMs);
    this.diagnostics.lastReceivedFrameSeq = frameSeq;
    this.lastDisplayReceiptAtMs = nowMs;
    this.diagnostics.msSinceLastDisplayReceipt = 0;
    this.diagnostics.deliveryPath = "fallback";
  }

  setChannelState(state: RealtimeChannelState): void {
    this.diagnostics.realtimeChannelState = state;
  }

  setDisplayAck(input: {
    frameSeq: number;
    receivedAtMs: number;
    transport: FeatureDeliveryTransport;
  }): void {
    this.diagnostics.lastDisplayAckFrameSeq = input.frameSeq;
    this.diagnostics.lastDisplayAckAtMs = input.receivedAtMs;
    this.diagnostics.lastDisplayAckTransport = input.transport;
  }

  tick(nowMs = Date.now()): void {
    if (this.lastDisplayReceiptAtMs !== null) {
      this.diagnostics.msSinceLastDisplayReceipt = nowMs - this.lastDisplayReceiptAtMs;
      if (this.diagnostics.msSinceLastDisplayReceipt > FEATURE_REALTIME_HEALTHY_MS) {
        if (this.diagnostics.deliveryPath !== "none") {
          this.diagnostics.deliveryPath = "none";
        }
      }
    }
  }
}

export type FeaturePublishOutcome =
  | { ok: true; response: FeaturePublishResponse }
  | { ok: false; errorCategory: string; status: number };

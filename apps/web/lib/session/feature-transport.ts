import {
  AUDIO_FEATURE_ENVELOPE_MAX_BYTES,
  AUDIO_FEATURE_ENVELOPE_STALE_MS,
  audioFeatureEnvelopeSchema,
  type AudioFeatureEnvelope,
  type FeatureDeliveryTransport,
  type FeaturePublishResponse,
  type FeatureReceiptBody,
  type FeatureReceiptResponse,
  type RealtimeBroadcastResult,
} from "@prism/contracts";
import type { SessionMessage } from "@prism/contracts";
import { assertPayloadSize } from "@prism/sync-engine";

import { logSessionBackendEvent } from "@/lib/session/backend-log";
import { isDurableSessionBackend } from "@/lib/session/config";
import { SessionServiceError } from "@/lib/session/errors";
import {
  getLatestFeatureReceiptMemory,
  getSessionFeaturesAfterMemory,
  publishSessionFeaturesMemory,
  recordFeatureReceiptMemory,
} from "@/lib/session/memory-store";
import { sessionCorrelationId } from "@/lib/session/session-correlation";
import {
  getLatestFeatureReceiptDurable,
  getSessionFeaturesAfterDurable,
  publishSessionFeaturesDurable,
  recordFeatureReceiptDurable,
  type SessionAdminClient,
} from "@/lib/session/supabase-store";
import { createOptionalAdminSupabase } from "@/lib/supabase/admin";

export type StoredFeatureFrame = {
  frameSeq: number;
  timestampMs: number;
  envelope: AudioFeatureEnvelope;
};

export type StoredFeatureReceipt = {
  deviceId: string;
  frameSeq: number;
  receivedAtMs: number;
  transport: FeatureDeliveryTransport;
};

function requireAdminClient(): SessionAdminClient {
  const client = createOptionalAdminSupabase();
  if (!client) {
    throw new SessionServiceError(
      "server_misconfigured",
      "Durable session backend is not configured.",
      503,
    );
  }
  return client as unknown as SessionAdminClient;
}

export function assertControllerRole(role: string): void {
  if (role !== "controller" && role !== "combined") {
    throw new SessionServiceError("unauthorized", "Displays cannot publish feature frames.", 401);
  }
}

export function validateEnvelope(envelope: AudioFeatureEnvelope, lastSeq: number): void {
  const age = Date.now() - envelope.timestampMs;
  if (age > AUDIO_FEATURE_ENVELOPE_STALE_MS || age < -5_000) {
    throw new SessionServiceError("invalid_request", "Stale feature envelope.", 400);
  }
  if (envelope.frameSeq <= lastSeq) {
    throw new SessionServiceError("invalid_request", "Out-of-order feature envelope.", 400);
  }
  assertPayloadSize(envelope, AUDIO_FEATURE_ENVELOPE_MAX_BYTES);
  const forbidden = JSON.stringify(envelope);
  if (/bands|pcm|fft|MediaStream|frequencyData|video/i.test(forbidden)) {
    throw new SessionServiceError("forbidden_payload", "Payload contains forbidden fields.", 400);
  }
}

export function logFeatureTransportEvent(input: {
  operation: string;
  sessionId: string;
  category: string;
  code: string;
  frameSeq?: number;
  transport?: string;
}): void {
  logSessionBackendEvent({
    operation: input.operation,
    table: "session_feature_frames",
    category: input.category,
    code: input.code,
  });
  const payload: Record<string, string | number> = {
    scope: "feature_transport",
    operation: input.operation,
    session: sessionCorrelationId(input.sessionId),
    category: input.category,
    code: input.code,
  };
  if (input.frameSeq !== undefined) payload.frameSeq = input.frameSeq;
  if (input.transport) payload.transport = input.transport;
  console.error(JSON.stringify(payload));
}

export async function publishSessionFeatures(
  token: string,
  envelope: AudioFeatureEnvelope,
): Promise<FeaturePublishResponse> {
  const parsed = audioFeatureEnvelopeSchema.parse(envelope);
  if (isDurableSessionBackend()) {
    return publishSessionFeaturesDurable(requireAdminClient(), token, parsed);
  }
  return publishSessionFeaturesMemory(token, parsed);
}

export async function getSessionFeaturesAfter(
  token: string,
  afterSeq: number,
): Promise<StoredFeatureFrame | null> {
  if (isDurableSessionBackend()) {
    return getSessionFeaturesAfterDurable(requireAdminClient(), token, afterSeq);
  }
  return getSessionFeaturesAfterMemory(token, afterSeq);
}

export async function recordFeatureReceipt(
  token: string,
  body: FeatureReceiptBody,
): Promise<FeatureReceiptResponse> {
  if (isDurableSessionBackend()) {
    return recordFeatureReceiptDurable(requireAdminClient(), token, body);
  }
  return recordFeatureReceiptMemory(token, body);
}

export async function getLatestFeatureReceipt(token: string): Promise<StoredFeatureReceipt | null> {
  if (isDurableSessionBackend()) {
    return getLatestFeatureReceiptDurable(requireAdminClient(), token);
  }
  return getLatestFeatureReceiptMemory(token);
}

export function buildFeatureBroadcastMessage(input: {
  sessionId: string;
  deviceId: string;
  envelope: AudioFeatureEnvelope;
  sentAt: string;
}): SessionMessage {
  return {
    type: "audio.features",
    seq: 0,
    sentAt: input.sentAt,
    sessionId: input.sessionId,
    deviceId: input.deviceId,
    payload: input.envelope,
  };
}

export function classifyRealtimeBroadcastError(error: unknown): RealtimeBroadcastResult {
  if (error instanceof SessionServiceError && error.code === "session_backend_unavailable") {
    return "unavailable";
  }
  return "failed";
}

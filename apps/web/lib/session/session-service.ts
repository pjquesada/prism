import type {
  DeviceRole,
  DisplayMode,
  GuestCredential,
  PublicGuestIdentity,
  SessionMessage,
  SessionSnapshot,
} from "@prism/contracts";

import { getSessionTransport, isDurableSessionBackend } from "@/lib/session/config";
import { SessionServiceError } from "@/lib/session/errors";
import {
  authorizeCredential as authorizeCredentialMemory,
  createGuestSession as createGuestSessionMemory,
  endSession as endSessionMemory,
  getSnapshotForCredential as getSnapshotForCredentialMemory,
  handoffController as handoffControllerMemory,
  heartbeat as heartbeatMemory,
  joinWithPairingCode as joinWithPairingCodeMemory,
  publicIdentity as publicIdentityMemory,
  publishAuthorizedMessage as publishAuthorizedMessageMemory,
  rotatePairingCode as rotatePairingCodeMemory,
  subscribeSession as subscribeSessionMemory,
} from "@/lib/session/memory-store";
import { enforceJoinRateLimit, enforceRotateRateLimit } from "@/lib/session/rate-limit";
import { createOptionalAdminSupabase } from "@/lib/supabase/admin";
import {
  authorizeCredentialDurable,
  createGuestSessionDurable,
  endSessionDurable,
  getSnapshotForCredentialDurable,
  handoffControllerDurable,
  heartbeatDurable,
  joinWithPairingCodeDurable,
  publicIdentity as publicIdentityDurable,
  publishAuthorizedMessageDurable,
  rotatePairingCodeDurable,
  type SessionAdminClient,
} from "@/lib/session/supabase-store";

export { SessionServiceError } from "@/lib/session/errors";
export type { SessionErrorCode } from "@/lib/session/errors";
export type { SessionTransportKind } from "@/lib/session/config";

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

export function resolveSessionTransport(): "memory" | "supabase" {
  return getSessionTransport();
}

export function toPublicIdentity(credential: GuestCredential): PublicGuestIdentity {
  return isDurableSessionBackend()
    ? publicIdentityDurable(credential)
    : publicIdentityMemory(credential);
}

export async function createGuestSession(input: {
  hostDeviceId?: string;
  role?: DeviceRole;
  displayMode?: DisplayMode;
}): Promise<{
  snapshot: SessionSnapshot;
  credential: GuestCredential;
  pairingCode: string;
  pairingExpiresAt: string;
}> {
  if (isDurableSessionBackend()) {
    return createGuestSessionDurable(requireAdminClient(), input);
  }
  return createGuestSessionMemory(input);
}

export async function joinWithPairingCode(input: {
  code: string;
  role?: DeviceRole;
  deviceId?: string;
  label?: string | null;
  ip?: string;
}): Promise<{
  snapshot: SessionSnapshot;
  credential: GuestCredential;
}> {
  enforceJoinRateLimit(input.ip ?? "unknown");
  if (isDurableSessionBackend()) {
    return joinWithPairingCodeDurable(requireAdminClient(), input);
  }
  return joinWithPairingCodeMemory(input);
}

export async function rotatePairingCode(
  token: string,
  ip?: string,
): Promise<{ pairingCode: string; pairingExpiresAt: string }> {
  const cred = await authorizeCredential(token);
  enforceRotateRateLimit(ip ?? "unknown", cred.sessionId);
  if (isDurableSessionBackend()) {
    return rotatePairingCodeDurable(requireAdminClient(), token);
  }
  return rotatePairingCodeMemory(token);
}

export async function authorizeCredential(token: string) {
  if (isDurableSessionBackend()) {
    return authorizeCredentialDurable(requireAdminClient(), token);
  }
  return authorizeCredentialMemory(token);
}

export async function getSnapshotForCredential(token: string): Promise<SessionSnapshot> {
  if (isDurableSessionBackend()) {
    return getSnapshotForCredentialDurable(requireAdminClient(), token);
  }
  return getSnapshotForCredentialMemory(token);
}

export async function heartbeat(token: string): Promise<SessionSnapshot> {
  if (isDurableSessionBackend()) {
    return heartbeatDurable(requireAdminClient(), token);
  }
  return heartbeatMemory(token);
}

export async function endSession(token: string): Promise<void> {
  if (isDurableSessionBackend()) {
    return endSessionDurable(requireAdminClient(), token);
  }
  return endSessionMemory(token);
}

export async function handoffController(
  token: string,
  targetDeviceId: string,
): Promise<SessionSnapshot> {
  if (isDurableSessionBackend()) {
    return handoffControllerDurable(requireAdminClient(), token, targetDeviceId);
  }
  return handoffControllerMemory(token, targetDeviceId);
}

export async function publishAuthorizedMessage(
  token: string,
  message: SessionMessage,
): Promise<SessionMessage> {
  if (isDurableSessionBackend()) {
    return publishAuthorizedMessageDurable(requireAdminClient(), token, message);
  }
  return publishAuthorizedMessageMemory(token, message);
}

export function subscribeSession(
  sessionId: string,
  listener: (message: SessionMessage) => void,
): () => void {
  if (isDurableSessionBackend()) {
    return () => undefined;
  }
  return subscribeSessionMemory(sessionId, listener);
}

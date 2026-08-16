"use client";

import { useEffect, useState } from "react";
import type { GuestCredential } from "@prism/contracts";
import { createSyncEngineState, type SyncEngineState } from "@prism/sync-engine";

import { SessionClient } from "@/lib/session/session-client";

const CREDENTIAL_STORAGE_KEY = "prism.session.credential.v1";
const CREDENTIAL_HANDOFF_KEY = "prism.session.credential.handoff.v1";

function readJsonStorage(storage: Storage, key: string): GuestCredential | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as GuestCredential;
  } catch {
    return null;
  }
}

function writeJsonStorage(storage: Storage, key: string, value: GuestCredential | null): void {
  try {
    if (!value) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / blocked storage — cookie handoff still applies.
  }
}

export function loadStoredCredential(): GuestCredential | null {
  if (typeof window === "undefined") return null;
  try {
    return readJsonStorage(window.localStorage, CREDENTIAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeCredential(credential: GuestCredential | null): void {
  if (typeof window === "undefined") return;
  writeJsonStorage(window.localStorage, CREDENTIAL_STORAGE_KEY, credential);
}

/** Persist across the join → display SPA navigation even when localStorage is blocked. */
export function stashCredentialHandoff(credential: GuestCredential): void {
  if (typeof window === "undefined") return;
  writeJsonStorage(window.sessionStorage, CREDENTIAL_HANDOFF_KEY, credential);
  storeCredential(credential);
}

export function takeCredentialForSession(sessionId: string): GuestCredential | null {
  if (typeof window === "undefined") return null;
  const handoff = readJsonStorage(window.sessionStorage, CREDENTIAL_HANDOFF_KEY);
  if (handoff?.sessionId === sessionId) {
    writeJsonStorage(window.sessionStorage, CREDENTIAL_HANDOFF_KEY, null);
    storeCredential(handoff);
    return handoff;
  }
  const stored = loadStoredCredential();
  if (stored?.sessionId === sessionId) return stored;
  return null;
}

export function useSessionClient() {
  const [sync, setSync] = useState<SyncEngineState>(() => createSyncEngineState());
  const [client] = useState(() => new SessionClient({ onState: setSync }));

  useEffect(() => {
    return () => {
      client.dispose();
    };
  }, [client]);

  return { client, sync };
}

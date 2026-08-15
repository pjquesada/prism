"use client";

import { useEffect, useState } from "react";
import type { GuestCredential } from "@prism/contracts";
import { createSyncEngineState, type SyncEngineState } from "@prism/sync-engine";

import { SessionClient } from "@/lib/session/session-client";

const CREDENTIAL_STORAGE_KEY = "prism.session.credential.v1";

export function loadStoredCredential(): GuestCredential | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CREDENTIAL_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GuestCredential;
  } catch {
    return null;
  }
}

export function storeCredential(credential: GuestCredential | null): void {
  if (typeof window === "undefined") return;
  if (!credential) {
    window.localStorage.removeItem(CREDENTIAL_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify(credential));
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

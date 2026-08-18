"use client";

import { useEffect, useState } from "react";
import { createSyncEngineState, type SyncEngineState } from "@prism/sync-engine";

import { SessionClient } from "@/lib/session/session-client";
import { clearSessionMeta, stashSessionMeta, takeSessionMeta } from "@/lib/session/session-meta";

export { stashSessionMeta, takeSessionMeta, clearSessionMeta };

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

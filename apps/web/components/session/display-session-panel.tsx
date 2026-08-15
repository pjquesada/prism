"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { GuestCredential } from "@prism/contracts";

import { ConnectionBanner } from "@/components/session/connection-banner";
import { SessionVisualizerStage } from "@/components/session/session-visualizer-stage";
import { loadStoredCredential, useSessionClient } from "@/lib/session/use-session-client";

function subscribeNoop(): () => void {
  return () => undefined;
}

function readCredentialForSession(sessionId: string): GuestCredential | null {
  const cred = loadStoredCredential();
  if (!cred || cred.sessionId !== sessionId) return null;
  return cred;
}

export function DisplaySessionPanel() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { client, sync } = useSessionClient();
  const credential = useSyncExternalStore(
    subscribeNoop,
    () => readCredentialForSession(sessionId),
    () => null,
  );
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    if (!credential) return;
    void client.restore(credential).catch((err) => {
      setRestoreError(err instanceof Error ? err.message : "restore_failed");
    });
  }, [client, credential]);

  if (!credential || restoreError === "unauthorized" || sync.connection === "unauthorized") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="text-prism-ember" role="alert">
          Unauthorized. Join with a pairing code first.
        </p>
        <Link href="/join" className="prism-btn prism-btn-primary">
          Join session
        </Link>
      </div>
    );
  }

  if (sync.connection === "ended" || sync.snapshot?.session.status === "ended") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="text-prism-ember" role="status">
          Session ended.
        </p>
        <Link href="/join" className="prism-btn prism-btn-primary">
          Join another
        </Link>
      </div>
    );
  }

  return (
    <main className="prism-shell min-h-dvh">
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 py-4 sm:px-6">
        <header className="mb-4 flex items-center justify-between gap-3">
          <p className="font-display text-xl font-bold tracking-tight">Prism</p>
          <p className="text-sm text-prism-mist" data-testid="display-visualizer">
            {sync.snapshot?.preset.visualizerId ?? "…"}
          </p>
        </header>
        <ConnectionBanner status={sync.connection} />
        {restoreError && restoreError !== "unauthorized" ? (
          <p className="mb-3 text-sm text-prism-ember" role="alert">
            Could not restore session ({restoreError}).
          </p>
        ) : null}
        <SessionVisualizerStage
          sync={sync}
          isAudioAuthority={sync.localRole === "combined" || sync.localRole === "controller"}
          className="mt-4 flex-1"
        />
      </div>
    </main>
  );
}

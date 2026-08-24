"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConnectionBanner } from "@/components/session/connection-banner";
import { SessionVisualizerStage } from "@/components/session/session-visualizer-stage";
import { takeSessionMeta, useSessionClient } from "@/lib/session/use-session-client";

export function DisplaySessionPanel() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { client, sync } = useSessionClient();
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [readyToRender, setReadyToRender] = useState(false);
  const attemptedSessionRef = useRef<string | null>(null);

  const restore = useCallback(() => {
    if (!sessionId) return;
    setRestoreError(null);
    setReadyToRender(true);
    takeSessionMeta(sessionId);
    void client.restoreWithCookie(sessionId).catch((err) => {
      setRestoreError(err instanceof Error ? err.message : "restore_failed");
    });
  }, [client, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (attemptedSessionRef.current === sessionId) return;
    attemptedSessionRef.current = sessionId;
    restore();
  }, [restore, sessionId]);

  const retry = () => {
    attemptedSessionRef.current = null;
    restore();
  };

  if (!readyToRender || (sync.connection === "connecting" && !sync.snapshot && !restoreError)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="text-prism-mist" role="status">
          Connecting…
        </p>
      </div>
    );
  }

  if (restoreError === "unauthorized" || sync.connection === "unauthorized") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="text-prism-ember" role="alert" data-testid="restore-error">
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

  if (
    !sync.snapshot &&
    (restoreError ||
      sync.connection === "error" ||
      sync.connection === "offline" ||
      restoreError === "restore_timeout")
  ) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="text-prism-ember" role="alert" data-testid="display-restore-timeout">
          Could not load the session snapshot. Check your connection and retry.
        </p>
        <button
          type="button"
          className="prism-btn prism-btn-primary"
          data-testid="restore-retry"
          onClick={retry}
        >
          Retry
        </button>
        <Link href="/join" className="prism-btn prism-btn-ghost">
          Join session
        </Link>
      </div>
    );
  }

  // Wait until the cookie restore resolves a role so hydration cannot briefly
  // treat this surface as an audio authority.
  if (sync.localRole === null && sync.connection === "connecting") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="text-prism-mist" role="status">
          Connecting…
        </p>
      </div>
    );
  }

  return (
    <main
      className="prism-display-root"
      data-testid="display-root"
      data-role={sync.localRole ?? "unresolved"}
    >
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <p className="font-display text-xl font-bold tracking-tight">Prism</p>
        <p className="text-sm text-prism-mist" data-testid="display-visualizer">
          {sync.snapshot?.preset.visualizerId ?? "…"}
        </p>
      </header>
      <div className="relative z-10 px-4 sm:px-6">
        <ConnectionBanner status={sync.connection} />
        {restoreError && restoreError !== "unauthorized" && restoreError !== "restore_timeout" ? (
          <p className="mb-3 text-sm text-prism-ember" role="alert" data-testid="restore-error">
            Could not restore session ({restoreError}).
          </p>
        ) : null}
      </div>
      <SessionVisualizerStage
        sync={sync}
        isAudioAuthority={false}
        immersive
        subscribeFeatures={(listener) => client.subscribeFeatures(listener)}
        className="relative z-10 min-h-0 flex-1 px-4 pb-3 sm:px-6"
      />
    </main>
  );
}

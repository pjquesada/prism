"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { ConnectionBanner } from "@/components/session/connection-banner";
import { stashCredentialHandoff, useSessionClient } from "@/lib/session/use-session-client";

function subscribeNoop(): () => void {
  return () => undefined;
}

function readJoinCodeFromLocation(): string {
  if (typeof window === "undefined") return "";
  return (new URLSearchParams(window.location.search).get("code") ?? "").toUpperCase();
}

export function JoinSessionPanel() {
  const router = useRouter();
  const { client, sync } = useSessionClient();
  const locationCode = useSyncExternalStore(subscribeNoop, readJoinCodeFromLocation, () => "");
  const [overrideCode, setOverrideCode] = useState<string | null>(null);
  const code = overrideCode ?? locationCode;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const joined = await client.join({ code, role: "display" });
      stashCredentialHandoff(joined.credential);
      router.replace(`/display/${joined.credential.sessionId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "join_failed";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <ConnectionBanner status={sync.connection} />
      <label className="flex flex-col gap-2">
        <span className="text-sm text-prism-mist">Six-character code</span>
        <input
          value={code}
          onChange={(event) => setOverrideCode(event.target.value.toUpperCase())}
          maxLength={6}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="rounded-sm border border-prism-slate bg-prism-deep/80 px-4 py-3 font-display text-2xl tracking-[0.3em] text-prism-foam outline-none focus:border-prism-aurora"
          placeholder="AB3K7M"
          data-testid="join-code-input"
        />
      </label>
      <button
        type="button"
        className="prism-btn prism-btn-primary w-fit"
        disabled={busy || code.trim().length < 6}
        onClick={() => void join()}
      >
        {busy ? "Joining…" : "Join as display"}
      </button>
      {error === "invalid_or_expired" ? (
        <p className="text-sm text-prism-ember" role="alert" data-testid="join-error">
          Invalid or expired code. Ask the controller for a fresh code.
        </p>
      ) : null}
      {error === "rate_limited" ? (
        <p className="text-sm text-prism-ember" role="alert">
          Too many attempts. Wait a moment and try again.
        </p>
      ) : null}
      {error && error !== "invalid_or_expired" && error !== "rate_limited" ? (
        <p className="text-sm text-prism-ember" role="alert">
          Could not join ({error}).
        </p>
      ) : null}
    </div>
  );
}

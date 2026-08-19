"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConnectionBanner } from "@/components/session/connection-banner";
import { PairingQr } from "@/components/session/pairing-qr";
import { SessionBackendBanner } from "@/components/session/session-backend-banner";
import { safeMessageForCode } from "@/lib/session/safe-errors";
import type { SessionErrorCode } from "@/lib/session/errors";
import { useSessionBackendHealth } from "@/lib/session/use-session-backend-health";
import { stashSessionMeta, useSessionClient } from "@/lib/session/use-session-client";

function messageForCreateError(code: string): string {
  const known = code as SessionErrorCode;
  const knownCodes: SessionErrorCode[] = [
    "invalid_or_expired",
    "rate_limited",
    "unauthorized",
    "ended",
    "not_found",
    "payload_too_large",
    "forbidden_payload",
    "backend_unavailable",
    "server_misconfigured",
    "session_backend_unavailable",
    "schema_mismatch",
    "constraint_violation",
    "database_unavailable",
    "configuration_error",
  ];
  if (knownCodes.includes(known)) {
    return safeMessageForCode(known);
  }
  return "Could not start session.";
}

export function StartSessionPanel() {
  const router = useRouter();
  const { client, sync } = useSessionClient();
  const backend = useSessionBackendHealth();
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<"combined" | "controller">("combined");

  const sessionId = sync.snapshot?.session.id;
  const backendBlocksStart = backend.status !== "ready" && backend.status !== "checking";

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await client.create({ role });
      stashSessionMeta({
        sessionId: created.credential.sessionId,
        deviceId: created.credential.deviceId,
        role: created.credential.role,
        intendedRoute: role,
      });
      setPairingCode(created.pairingCode);
      setJoinUrl(created.joinUrl);
      setPairingExpiresAt(created.pairingExpiresAt);
    } catch (err) {
      const code = err instanceof Error ? err.message : "create_failed";
      setError(messageForCreateError(code));
      void backend.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {!sessionId ? (
        <SessionBackendBanner status={backend.status} />
      ) : (
        <ConnectionBanner status={sync.connection} />
      )}

      {!sessionId ? (
        <section className="flex flex-col gap-4">
          <p className="max-w-xl text-prism-mist">
            Create a guest session, share a six-character code or QR, and sync displays. No account
            required. Audio analysis stays on each device — never transmitted.
          </p>
          <div className="flex flex-wrap gap-3" role="group" aria-label="Starting role">
            <button
              type="button"
              className={
                role === "combined" ? "prism-btn prism-btn-primary" : "prism-btn prism-btn-ghost"
              }
              aria-pressed={role === "combined"}
              onClick={() => setRole("combined")}
            >
              Combined
            </button>
            <button
              type="button"
              className={
                role === "controller" ? "prism-btn prism-btn-primary" : "prism-btn prism-btn-ghost"
              }
              aria-pressed={role === "controller"}
              onClick={() => setRole("controller")}
            >
              Controller only
            </button>
          </div>
          <button
            type="button"
            className="prism-btn prism-btn-primary w-fit"
            disabled={busy || backendBlocksStart}
            onClick={() => void start()}
          >
            {busy ? "Starting…" : "Start guest session"}
          </button>
          {error ? (
            <p className="text-sm text-prism-ember" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="grid gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="text-sm uppercase tracking-[0.14em] text-prism-aurora">Pairing code</p>
            <p
              className="mt-3 font-display text-5xl font-bold tracking-[0.2em] text-prism-foam"
              data-testid="pairing-code"
            >
              {pairingCode}
            </p>
            {pairingExpiresAt ? (
              <p className="mt-2 text-sm text-prism-mist">
                Expires {new Date(pairingExpiresAt).toLocaleTimeString()}
              </p>
            ) : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                className="prism-btn prism-btn-primary"
                onClick={() => router.push(`/controller/${sessionId}`)}
              >
                Open controller
              </button>
              {role === "combined" ? (
                <button
                  type="button"
                  className="prism-btn prism-btn-ghost"
                  onClick={() => router.push(`/display/${sessionId}`)}
                >
                  Open display
                </button>
              ) : null}
              <Link href="/join" className="prism-btn prism-btn-ghost">
                Join another session
              </Link>
            </div>
          </div>
          {joinUrl ? <PairingQr joinUrl={joinUrl} /> : null}
        </section>
      )}
    </div>
  );
}

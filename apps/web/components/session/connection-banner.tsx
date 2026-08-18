"use client";

import type { ConnectionStatus } from "@prism/sync-engine";

const LABELS: Record<ConnectionStatus, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  offline: "Offline",
  unauthorized: "Unauthorized",
  ended: "Session ended",
  error: "Could not restore session",
};

export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  if (status === "connected" || status === "idle") return null;
  const tone =
    status === "ended" || status === "unauthorized"
      ? "border-prism-ember/50 text-prism-ember"
      : "border-prism-aurora/40 text-prism-foam";
  return (
    <div
      className={`rounded-sm border px-4 py-3 text-sm ${tone} bg-prism-deep/70`}
      role="status"
      aria-live="polite"
    >
      {LABELS[status]}
    </div>
  );
}

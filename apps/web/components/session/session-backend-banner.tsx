"use client";

import {
  CLIENT_BACKEND_LABELS,
  type ClientBackendStatus,
} from "@/lib/session/client-backend-status";

export function SessionBackendBanner({ status }: { status: ClientBackendStatus }) {
  if (status === "ready" || status === "checking") return null;

  const tone =
    status === "browser_offline" || status === "app_unreachable"
      ? "border-prism-ember/50 text-prism-ember"
      : "border-prism-aurora/40 text-prism-foam";

  return (
    <div
      className={`rounded-sm border px-4 py-3 text-sm ${tone} bg-prism-deep/70`}
      role="status"
      aria-live="polite"
      data-testid="session-backend-banner"
      data-backend-status={status}
    >
      {CLIENT_BACKEND_LABELS[status]}
    </div>
  );
}

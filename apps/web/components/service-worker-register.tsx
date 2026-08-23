"use client";

import { useEffect, useState } from "react";

/**
 * Registers the production service worker without auto-activating a waiting
 * worker mid-session. When an update is waiting, shows Reload so stale PWA
 * bundles (including old display audio paths) are replaced intentionally.
 */
export function ServiceWorkerRegister() {
  const [updateReady, setUpdateReady] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;

    const onUpdateFound = () => {
      const installing = registration?.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          if (!cancelled) {
            setWaitingWorker(registration?.waiting ?? installing);
            setUpdateReady(true);
          }
        }
      });
    };

    void navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        if (reg.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(reg.waiting);
          setUpdateReady(true);
        }
        reg.addEventListener("updatefound", onUpdateFound);
        void reg.update().catch(() => {
          // Non-fatal — offline / blocked update checks are fine.
        });
      })
      .catch(() => {
        // Registration failures are non-fatal for the foundation shell.
      });

    const onControllerChange = () => {
      // After SKIP_WAITING + claim, reload once to pick up the new bundle.
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      registration?.removeEventListener?.("updatefound", onUpdateFound);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[60] flex w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 flex-col gap-3 rounded-sm border border-prism-slate bg-prism-ink/95 px-4 py-3 shadow-lg backdrop-blur"
      role="status"
      data-testid="sw-update-banner"
    >
      <p className="text-sm text-prism-foam">
        Update available — Reload to replace cached app files. Active capture will stop.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="prism-btn prism-btn-primary"
          data-testid="sw-update-reload"
          onClick={() => {
            waitingWorker?.postMessage({ type: "PRISM_SKIP_WAITING" });
            // If there is no waiting worker message path, force reload anyway.
            window.setTimeout(() => {
              window.location.reload();
            }, 400);
          }}
        >
          Reload
        </button>
        <button
          type="button"
          className="prism-btn prism-btn-ghost"
          onClick={() => setUpdateReady(false)}
        >
          Later
        </button>
      </div>
    </div>
  );
}

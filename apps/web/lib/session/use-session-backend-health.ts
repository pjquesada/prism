"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CLIENT_BACKEND_LABELS,
  mapHealthStatusToClient,
  type ClientBackendStatus,
} from "@/lib/session/client-backend-status";

type HealthPayload = {
  ok?: boolean;
  checks?: {
    sessionBackend?: {
      status?: string;
    };
  };
};

async function fetchBackendStatus(): Promise<ClientBackendStatus> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "browser_offline";
  }

  try {
    const res = await fetch("/api/health", { credentials: "same-origin" });
    const data = (await res.json()) as HealthPayload;
    const backendStatus = data.checks?.sessionBackend?.status;
    if (backendStatus === "ready" || data.ok === true) {
      return "ready";
    }
    if (
      backendStatus === "misconfigured" ||
      backendStatus === "schema_mismatch" ||
      backendStatus === "unavailable"
    ) {
      return mapHealthStatusToClient(backendStatus);
    }
    return "unavailable";
  } catch {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return "browser_offline";
    }
    return "app_unreachable";
  }
}

export function useSessionBackendHealth() {
  const [status, setStatus] = useState<ClientBackendStatus>("checking");
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setStatus("checking");
    const next = await fetchBackendStatus();
    if (mountedRef.current) {
      setStatus(next);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    void (async () => {
      const next = await fetchBackendStatus();
      if (mountedRef.current) {
        setStatus(next);
      }
    })();

    const onConnectivity = () => {
      void refresh();
    };
    window.addEventListener("online", onConnectivity);
    window.addEventListener("offline", onConnectivity);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("online", onConnectivity);
      window.removeEventListener("offline", onConnectivity);
    };
  }, [refresh]);

  return {
    status,
    label: CLIENT_BACKEND_LABELS[status],
    refresh,
  };
}

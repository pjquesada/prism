"use client";

import type { ConnectionStatus } from "@prism/sync-engine";
import { requireVisualizerPlugin } from "@prism/visualizers";
import type { VisualizerId } from "@prism/contracts";

export type SyncSaveState = "saved" | "saving" | "error";

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  idle: "Idle",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
  unauthorized: "Unauthorized",
  ended: "Ended",
  error: "Connection error",
};

const SAVE_LABELS: Record<SyncSaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  error: "Save failed",
};

type SessionSyncStatusProps = {
  visualizerId: VisualizerId;
  connection: ConnectionStatus;
  saveState: SyncSaveState;
  seq?: number;
};

export function SessionSyncStatus({
  visualizerId,
  connection,
  saveState,
  seq,
}: SessionSyncStatusProps) {
  const plugin = requireVisualizerPlugin(visualizerId);
  const connectionLabel = CONNECTION_LABELS[connection];
  const saveLabel = SAVE_LABELS[saveState];

  return (
    <div
      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
      role="status"
      aria-live="polite"
      data-testid="session-sync-status"
    >
      <p className="font-display text-lg text-prism-foam" data-testid="active-visualizer">
        {plugin.label}
      </p>
      <p className="text-prism-mist" data-testid="connection-state">
        {connectionLabel}
      </p>
      <p
        className={saveState === "error" ? "text-prism-ember" : "text-prism-mist"}
        data-testid="sync-save-state"
      >
        {saveLabel}
        {typeof seq === "number" ? ` · v${seq}` : ""}
      </p>
    </div>
  );
}

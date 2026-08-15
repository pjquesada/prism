/** Sync timing and payload budgets for Phase 1D. */

/** Soft drift: nudge playback rate / micro-correct. */
export const SMALL_DRIFT_MS = 80;

/** Hard drift: seek to projected position. */
export const LARGE_DRIFT_MS = 350;

/** Rate nudge magnitude while correcting small drift. */
export const DRIFT_RATE_NUDGE = 0.02;

export const PING_INTERVAL_MS = 3_000;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const PRESENCE_OFFLINE_MS = 45_000;

/** Max visual-intent / preset patch emit rate. */
export const VISUAL_INTENT_MAX_HZ = 15;

/** Playback anchor emit cadence while playing (not per-frame). */
export const PLAYBACK_ANCHOR_INTERVAL_MS = 2_000;

export const CHANNEL_NAME_PREFIX = "session:" as const;

export function sessionChannelName(sessionId: string): string {
  return `${CHANNEL_NAME_PREFIX}${sessionId}`;
}

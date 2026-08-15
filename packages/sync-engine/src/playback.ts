import type { PlaybackState } from "@prism/contracts";

import { DRIFT_RATE_NUDGE, LARGE_DRIFT_MS, SMALL_DRIFT_MS } from "./constants.js";

export type ProjectedPlayback = {
  positionMs: number;
  suggestedRate: number;
  driftMs: number;
  correction: "none" | "nudge" | "seek";
};

export function projectPlaybackPosition(playback: PlaybackState, sessionNowMs: number): number {
  if (!playback.isPlaying) return playback.positionMs;
  const anchorMs = Date.parse(playback.updatedAt);
  if (Number.isNaN(anchorMs)) return playback.positionMs;
  const elapsed = Math.max(0, sessionNowMs - anchorMs);
  return playback.positionMs + elapsed * playback.rate;
}

export function correctPlaybackDrift(input: {
  playback: PlaybackState;
  localPositionMs: number;
  sessionNowMs: number;
}): ProjectedPlayback {
  const projected = projectPlaybackPosition(input.playback, input.sessionNowMs);
  const driftMs = projected - input.localPositionMs;
  const abs = Math.abs(driftMs);

  if (!input.playback.isPlaying || abs < SMALL_DRIFT_MS) {
    return {
      positionMs: projected,
      suggestedRate: input.playback.rate,
      driftMs,
      correction: "none",
    };
  }

  if (abs < LARGE_DRIFT_MS) {
    const direction = driftMs > 0 ? 1 : -1;
    return {
      positionMs: projected,
      suggestedRate: Math.min(2, Math.max(0.5, input.playback.rate + direction * DRIFT_RATE_NUDGE)),
      driftMs,
      correction: "nudge",
    };
  }

  return {
    positionMs: projected,
    suggestedRate: input.playback.rate,
    driftMs,
    correction: "seek",
  };
}

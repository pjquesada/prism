import type { SessionMessage } from "@prism/contracts";

export type SeqState = {
  lastAppliedSeq: number;
  needsSnapshot: boolean;
};

export function createSeqState(lastAppliedSeq = 0): SeqState {
  return { lastAppliedSeq, needsSnapshot: lastAppliedSeq === 0 };
}

export type SeqDecision =
  | { action: "apply"; next: SeqState }
  | { action: "ignore_stale"; next: SeqState }
  | { action: "request_snapshot"; next: SeqState };

/**
 * Apply sequence rules: ignore stale, detect gaps, accept contiguous seq.
 * Snapshots apply when seq is greater than or equal to the last applied seq.
 * Older snapshots are ignored so they cannot overwrite newer visualizer state.
 */
export function decideSeq(state: SeqState, message: SessionMessage): SeqDecision {
  if (message.type === "audio.features") {
    return { action: "apply", next: state };
  }
  if (message.type === "session.snapshot") {
    if (message.seq < state.lastAppliedSeq) {
      return { action: "ignore_stale", next: state };
    }
    return {
      action: "apply",
      next: { lastAppliedSeq: message.seq, needsSnapshot: false },
    };
  }

  if (message.seq <= state.lastAppliedSeq) {
    return { action: "ignore_stale", next: state };
  }

  if (message.seq > state.lastAppliedSeq + 1) {
    return {
      action: "request_snapshot",
      next: { ...state, needsSnapshot: true },
    };
  }

  return {
    action: "apply",
    next: { lastAppliedSeq: message.seq, needsSnapshot: false },
  };
}

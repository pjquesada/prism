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
 * Snapshots may reset the cursor to the snapshot seq.
 */
export function decideSeq(state: SeqState, message: SessionMessage): SeqDecision {
  if (message.type === "session.snapshot") {
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

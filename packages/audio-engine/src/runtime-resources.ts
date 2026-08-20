export type PrismResourceKind =
  "audioContexts" | "mediaSources" | "animationLoops" | "realtimeSubscriptions";

export type PrismResourceCounts = Record<PrismResourceKind, number>;

const counts: PrismResourceCounts = {
  audioContexts: 0,
  mediaSources: 0,
  animationLoops: 0,
  realtimeSubscriptions: 0,
};

/**
 * Process-local counters for audio/render resources.
 * Development diagnostics only — never include samples, FFT, or secrets.
 */
export function acquireResource(kind: PrismResourceKind): () => void {
  counts[kind] += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    counts[kind] = Math.max(0, counts[kind] - 1);
  };
}

export function getResourceCounts(): PrismResourceCounts {
  return { ...counts };
}

export function resetResourceCountsForTests(): void {
  counts.audioContexts = 0;
  counts.mediaSources = 0;
  counts.animationLoops = 0;
  counts.realtimeSubscriptions = 0;
}

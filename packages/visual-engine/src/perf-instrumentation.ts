export type PrismPerfSnapshot = {
  fps: number;
  featureMessagesPerSecond: number;
  droppedOrStaleFrames: number;
  animationLoops: number;
  audioContexts: number;
  mediaSources: number;
  realtimeSubscriptions: number;
};

export type PrismResourceSnapshot = {
  audioContexts: number;
  mediaSources: number;
  animationLoops: number;
  realtimeSubscriptions: number;
};

type PerfState = {
  frames: number;
  lastFpsMs: number;
  fps: number;
  features: number;
  lastFeatureHzMs: number;
  featureHz: number;
  dropped: number;
  animationLoops: number;
};

const state: PerfState = {
  frames: 0,
  lastFpsMs: 0,
  fps: 0,
  features: 0,
  lastFeatureHzMs: 0,
  featureHz: 0,
  dropped: 0,
  animationLoops: 0,
};

let resourceSource: (() => PrismResourceSnapshot) | null = null;

function readProcessEnv(name: string): string | undefined {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env?.[name];
}

function perfEnabled(): boolean {
  if (readProcessEnv("NODE_ENV") === "production") {
    return readProcessEnv("NEXT_PUBLIC_PRISM_PERF") === "1";
  }
  return readProcessEnv("NEXT_PUBLIC_PRISM_PERF") !== "0";
}

export function isPrismPerfEnabled(): boolean {
  return perfEnabled();
}

/** Wire process-local audio/realtime counters without importing audio-engine here. */
export function registerPerfResourceSource(source: () => PrismResourceSnapshot): void {
  resourceSource = source;
}

export function acquireAnimationLoop(): () => void {
  state.animationLoops += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.animationLoops = Math.max(0, state.animationLoops - 1);
  };
}

export function noteRenderFrame(
  nowMs = typeof performance !== "undefined" ? performance.now() : 0,
): void {
  if (!perfEnabled()) return;
  state.frames += 1;
  if (state.lastFpsMs === 0) state.lastFpsMs = nowMs;
  const elapsed = nowMs - state.lastFpsMs;
  if (elapsed >= 1000) {
    state.fps = Math.round((state.frames * 1000) / elapsed);
    state.frames = 0;
    state.lastFpsMs = nowMs;
    publishPerfSnapshot();
  }
}

export function noteFeatureMessage(nowMs = Date.now()): void {
  if (!perfEnabled()) return;
  state.features += 1;
  if (state.lastFeatureHzMs === 0) state.lastFeatureHzMs = nowMs;
  const elapsed = nowMs - state.lastFeatureHzMs;
  if (elapsed >= 1000) {
    state.featureHz = Math.round((state.features * 1000) / elapsed);
    state.features = 0;
    state.lastFeatureHzMs = nowMs;
  }
}

export function noteDroppedOrStaleFrame(): void {
  if (!perfEnabled()) return;
  state.dropped += 1;
}

export function getPrismPerfSnapshot(): PrismPerfSnapshot {
  const resources = resourceSource?.() ?? {
    audioContexts: 0,
    mediaSources: 0,
    animationLoops: 0,
    realtimeSubscriptions: 0,
  };
  return {
    fps: state.fps,
    featureMessagesPerSecond: state.featureHz,
    droppedOrStaleFrames: state.dropped,
    animationLoops: state.animationLoops + resources.animationLoops,
    audioContexts: resources.audioContexts,
    mediaSources: resources.mediaSources,
    realtimeSubscriptions: resources.realtimeSubscriptions,
  };
}

export function resetPrismPerfForTests(): void {
  state.frames = 0;
  state.lastFpsMs = 0;
  state.fps = 0;
  state.features = 0;
  state.lastFeatureHzMs = 0;
  state.featureHz = 0;
  state.dropped = 0;
  state.animationLoops = 0;
}

function publishPerfSnapshot(): void {
  if (typeof window === "undefined" || !perfEnabled()) return;
  const snapshot = getPrismPerfSnapshot();
  (window as Window & { __PRISM_PERF__?: PrismPerfSnapshot }).__PRISM_PERF__ = snapshot;
}

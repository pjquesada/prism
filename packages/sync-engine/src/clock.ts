export type ClockEstimate = {
  /** Estimated offset: sessionNow ≈ localNow + offsetMs */
  offsetMs: number;
  rttMs: number;
  samples: number;
};

export function createClockEstimate(): ClockEstimate {
  return { offsetMs: 0, rttMs: 0, samples: 0 };
}

/**
 * Update clock estimate from a ping/pong round trip.
 * offset ≈ ((serverReceived + serverSent) / 2) - ((clientSent + clientRecv) / 2)
 * Simplified NTP-style midpoint using pong timestamps.
 */
export function applyPongSample(
  estimate: ClockEstimate,
  sample: {
    clientSentAtMs: number;
    serverReceivedAtMs: number;
    serverSentAtMs: number;
    clientReceivedAtMs: number;
  },
): ClockEstimate {
  const rtt = Math.max(0, sample.clientReceivedAtMs - sample.clientSentAtMs);
  const serverMid = (sample.serverReceivedAtMs + sample.serverSentAtMs) / 2;
  const clientMid = (sample.clientSentAtMs + sample.clientReceivedAtMs) / 2;
  const offsetSample = serverMid - clientMid;
  const samples = estimate.samples + 1;
  const alpha = samples === 1 ? 1 : 0.25;
  return {
    offsetMs: estimate.offsetMs * (1 - alpha) + offsetSample * alpha,
    rttMs: estimate.rttMs * (1 - alpha) + rtt * alpha,
    samples,
  };
}

export function sessionNowMs(estimate: ClockEstimate, localNowMs = Date.now()): number {
  return localNowMs + estimate.offsetMs;
}

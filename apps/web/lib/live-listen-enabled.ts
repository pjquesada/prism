export function isLiveListenEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_LIVE_LISTEN !== "false";
}

/** Alias — Capture Music replaces Live Listen as the primary product name. */
export function isCaptureMusicEnabled(): boolean {
  return isLiveListenEnabled();
}

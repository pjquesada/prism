export function isLiveListenEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_LIVE_LISTEN !== "false";
}

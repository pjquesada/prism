/** Resolve a browser AudioContext constructor. Returns null outside a Web Audio environment. */
export function createAudioContext(): AudioContext | null {
  const Ctor =
    typeof window !== "undefined"
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

export function isSecureAudioContext(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext !== false;
}

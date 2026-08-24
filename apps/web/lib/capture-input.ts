export type CaptureInputOption = "browser_capture" | "microphone" | "demo_track";

const STORAGE_KEY = "prism.captureInput";

export function readCaptureInputPreference(): CaptureInputOption {
  if (typeof window === "undefined") return "browser_capture";
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === "browser_capture" || raw === "microphone" || raw === "demo_track") return raw;
  } catch {
    // ignore storage failures
  }
  return "browser_capture";
}

export function writeCaptureInputPreference(option: CaptureInputOption): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, option);
  } catch {
    // ignore storage failures — preference is UX only, never media
  }
}

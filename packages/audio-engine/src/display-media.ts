import { isSecureAudioContext } from "./audio-context.js";

export type BrowserCaptureFailureStatus =
  "denied" | "no_audio" | "unsupported" | "inactive" | "ended" | "error";

export type BrowserCaptureFailure = {
  status: BrowserCaptureFailureStatus;
  message: string;
};

/**
 * Display-media constraints: request audio + a video track (required by most browsers).
 * Video is ignored immediately — never rendered, encoded, transmitted, or persisted.
 * Extra Chrome/Edge hints are attached when the runtime accepts them.
 */
export const BROWSER_CAPTURE_CONSTRAINTS: DisplayMediaStreamOptions = {
  video: {
    frameRate: 1,
    width: 16,
    height: 16,
  },
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
  },
};

/** Chromium-only hints merged when supported (feature-detected at call time). */
export const BROWSER_CAPTURE_CHROMIUM_HINTS = {
  preferCurrentTab: false,
  selfBrowserSurface: "exclude",
  systemAudio: "include",
  surfaceSwitching: "include",
  monitorTypeSurfaces: "include",
} as const;

export type DisplayMediaSupport = {
  secureContext: boolean;
  getDisplayMedia: boolean;
  /** True when getDisplayMedia exists; audio availability still depends on OS/browser dialog. */
  canAttemptAudioCapture: boolean;
};

export function detectDisplayMediaSupport(
  mediaDevices: Pick<MediaDevices, "getDisplayMedia"> | null | undefined,
  secureContext = isSecureAudioContext(),
): DisplayMediaSupport {
  const getDisplayMedia = Boolean(
    mediaDevices && typeof mediaDevices.getDisplayMedia === "function",
  );
  return {
    secureContext,
    getDisplayMedia,
    canAttemptAudioCapture: secureContext && getDisplayMedia,
  };
}

export function canRequestBrowserCapture(
  mediaDevices: Pick<MediaDevices, "getDisplayMedia"> | null | undefined,
  secureContext: boolean,
): boolean {
  return detectDisplayMediaSupport(mediaDevices, secureContext).canAttemptAudioCapture;
}

/**
 * Build getDisplayMedia options. Chromium hints are merged only when the object
 * can be extended; callers should still treat audio as best-effort.
 */
export function buildBrowserCaptureConstraints(): DisplayMediaStreamOptions {
  const base: DisplayMediaStreamOptions = {
    video: BROWSER_CAPTURE_CONSTRAINTS.video,
    audio: BROWSER_CAPTURE_CONSTRAINTS.audio,
  };
  return {
    ...base,
    ...BROWSER_CAPTURE_CHROMIUM_HINTS,
  } as DisplayMediaStreamOptions;
}

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "";
}

/**
 * Map getDisplayMedia failures to recoverable Capture Music UI states.
 * Never include raw media error objects or stream details in UI copy.
 */
export function classifyGetDisplayMediaError(error: unknown): BrowserCaptureFailure {
  const name = errorName(error);
  const message = errorMessage(error).toLowerCase();

  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "AbortError" ||
    message.includes("permission") ||
    message.includes("denied") ||
    message.includes("dismissed")
  ) {
    return {
      status: "denied",
      message:
        "Capture was blocked or denied. Try again and allow screen/tab sharing with audio, or use Microphone / Demo Track.",
    };
  }

  if (
    name === "NotSupportedError" ||
    name === "TypeError" ||
    name === "SecurityError" ||
    message.includes("secure context") ||
    message.includes("https") ||
    message.includes("getdisplaymedia")
  ) {
    return {
      status: "unsupported",
      message:
        "Browser/system audio capture is unavailable here. Prefer Chrome or Edge on desktop, or use Microphone / Demo Track.",
    };
  }

  return {
    status: "error",
    message: "Could not start Capture Music. Try again or use Microphone / Demo Track.",
  };
}

export const NO_AUDIO_SHARED_MESSAGE =
  "No audio was shared. Try again and make sure Share tab audio or Share system audio is enabled.";

export function streamHasAudioTrack(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  return stream.getAudioTracks().some((track) => track.readyState !== "ended");
}

/** Stop every track. Safe to call more than once. Never persists tracks. */
export function stopDisplayMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  }
}

/**
 * Immediately stop video tracks so pixels are never held. Audio tracks remain
 * for local analysis until stopDisplayMediaStream / engine dispose.
 */
export function discardCapturedVideoTracks(stream: MediaStream): void {
  for (const track of stream.getVideoTracks()) {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  }
}

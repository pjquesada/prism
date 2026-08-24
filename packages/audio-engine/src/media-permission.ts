export type LiveListenFailureStatus =
  "denied" | "unavailable" | "unsupported" | "inactive" | "error";

export type LiveListenFailure = {
  status: LiveListenFailureStatus;
  message: string;
};

/**
 * Analysis-oriented constraints. Noise suppression flattens visualization energy;
 * echo cancellation is unnecessary because the mic graph never reaches speakers.
 */
export const LIVE_LISTEN_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
  video: false,
};

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
 * Map getUserMedia failures to recoverable Microphone fallback UI states.
 * Never include raw media error objects in UI copy.
 */
export function classifyGetUserMediaError(error: unknown): LiveListenFailure {
  const name = errorName(error);
  const message = errorMessage(error).toLowerCase();

  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    message.includes("permission") ||
    message.includes("denied")
  ) {
    return {
      status: "denied",
      message:
        "Microphone permission was denied. Allow the microphone for this site in your browser settings, then try again — or use Capture Music / Demo Track.",
    };
  }

  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    message.includes("not found")
  ) {
    return {
      status: "unavailable",
      message: "No microphone was found. Connect a mic or switch to Capture Music / Demo Track.",
    };
  }

  if (
    name === "NotSupportedError" ||
    name === "TypeError" ||
    name === "SecurityError" ||
    message.includes("secure context") ||
    message.includes("https")
  ) {
    return {
      status: "unsupported",
      message:
        "This browser cannot access the microphone. Use HTTPS or localhost, or switch to Capture Music / Demo Track.",
    };
  }

  return {
    status: "error",
    message: "Could not start microphone capture. Try again or use Capture Music / Demo Track.",
  };
}

export function canRequestMicrophone(
  mediaDevices: Pick<MediaDevices, "getUserMedia"> | null | undefined,
  secureContext: boolean,
): boolean {
  return Boolean(secureContext && mediaDevices && typeof mediaDevices.getUserMedia === "function");
}

/** Stop every track on a MediaStream. Safe to call more than once. */
export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  }
}

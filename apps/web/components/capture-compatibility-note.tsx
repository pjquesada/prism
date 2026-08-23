"use client";

import { detectDisplayMediaSupport } from "@prism/audio-engine";
import { useEffect, useState } from "react";

type CompatibilityState = {
  canAttempt: boolean;
  secureContext: boolean;
  getDisplayMedia: boolean;
};

/**
 * Honest, feature-detected guidance — never claims guaranteed provider support.
 */
export function CaptureCompatibilityNote() {
  const [state, setState] = useState<CompatibilityState | null>(null);

  useEffect(() => {
    const devices = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    const support = detectDisplayMediaSupport(devices);
    setState({
      canAttempt: support.canAttemptAudioCapture,
      secureContext: support.secureContext,
      getDisplayMedia: support.getDisplayMedia,
    });
  }, []);

  if (!state) return null;

  return (
    <details className="text-sm text-prism-mist" data-testid="capture-compatibility">
      <summary className="cursor-pointer text-prism-foam">Browser compatibility</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Chrome / Edge desktop: preferred for tab or system audio capture.</li>
        <li>
          Tab audio: share the tab playing YouTube, Spotify Web Player, Apple Music Web, SoundCloud,
          or Pandora — and enable Share tab audio.
        </li>
        <li>Full system audio: only when the browser/OS dialog offers it.</li>
        <li>Firefox / Safari / mobile: may have limited or unavailable audio capture.</li>
        <li>
          Protected / DRM content may not expose capturable audio even when playback works. Prism
          does not claim guaranteed support for every streaming provider.
        </li>
        <li>
          This browser:{" "}
          {state.canAttempt
            ? "display-media capture API detected — try Capture Music, then fall back to Microphone or Demo Track if needed."
            : !state.secureContext
              ? "needs a secure context (HTTPS or localhost)."
              : "getDisplayMedia unavailable — use Microphone or Demo Track."}
        </li>
      </ul>
    </details>
  );
}

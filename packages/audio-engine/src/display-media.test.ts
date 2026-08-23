import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_CAPTURE_CONSTRAINTS,
  buildBrowserCaptureConstraints,
  canRequestBrowserCapture,
  classifyGetDisplayMediaError,
  discardCapturedVideoTracks,
  streamHasAudioTrack,
} from "./display-media.js";

describe("display-media permission helpers", () => {
  it("includes audio in capture requests", () => {
    expect(BROWSER_CAPTURE_CONSTRAINTS.audio).toBeTruthy();
    expect(buildBrowserCaptureConstraints().audio).toBeTruthy();
  });

  it("requires secure context and getDisplayMedia", () => {
    const devices = {
      getDisplayMedia: async () =>
        ({
          getTracks: () => [],
          getAudioTracks: () => [],
          getVideoTracks: () => [],
        }) as unknown as MediaStream,
    };
    expect(canRequestBrowserCapture(devices, true)).toBe(true);
    expect(canRequestBrowserCapture(devices, false)).toBe(false);
    expect(canRequestBrowserCapture(null, true)).toBe(false);
  });

  it("maps denied capture without leaking DOMException names", () => {
    const failure = classifyGetDisplayMediaError(
      Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }),
    );
    expect(failure.status).toBe("denied");
    expect(failure.message).not.toMatch(/NotAllowedError|DOMException/);
  });

  it("reports whether a stream still has live audio", () => {
    const audio = {
      kind: "audio",
      readyState: "live",
      stop: vi.fn(),
    };
    const video = {
      kind: "video",
      readyState: "live",
      stop: vi.fn(),
    };
    const stream = {
      getTracks: () => [audio, video],
      getAudioTracks: () => [audio],
      getVideoTracks: () => [video],
    } as unknown as MediaStream;
    expect(streamHasAudioTrack(stream)).toBe(true);
    discardCapturedVideoTracks(stream);
    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).not.toHaveBeenCalled();
    audio.readyState = "ended";
    expect(streamHasAudioTrack(stream)).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  LIVE_LISTEN_AUDIO_CONSTRAINTS,
  canRequestMicrophone,
  classifyGetUserMediaError,
  stopMediaStream,
} from "./media-permission.js";

describe("classifyGetUserMediaError", () => {
  it("maps permission denial to a recoverable denied state", () => {
    const failure = classifyGetUserMediaError(
      Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }),
    );
    expect(failure.status).toBe("denied");
    expect(failure.message).toMatch(/permission was denied/i);
    expect(failure.message).not.toMatch(/NotAllowedError/);
  });

  it("maps a missing device to unavailable", () => {
    const failure = classifyGetUserMediaError(
      Object.assign(new Error("Requested device not found"), { name: "NotFoundError" }),
    );
    expect(failure.status).toBe("unavailable");
    expect(failure.message).toMatch(/Capture Music|Demo Track/i);
  });

  it("maps insecure-context failures to unsupported", () => {
    const failure = classifyGetUserMediaError(
      Object.assign(new Error("secure context required"), { name: "SecurityError" }),
    );
    expect(failure.status).toBe("unsupported");
  });
});

describe("canRequestMicrophone", () => {
  it("requires a secure context and getUserMedia", () => {
    const devices = {
      getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream,
    };
    expect(canRequestMicrophone(devices, true)).toBe(true);
    expect(canRequestMicrophone(devices, false)).toBe(false);
    expect(canRequestMicrophone(null, true)).toBe(false);
  });
});

describe("stopMediaStream", () => {
  it("stops every track and is safe with null", () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }, { stop }],
    } as unknown as MediaStream;
    stopMediaStream(stream);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(() => stopMediaStream(null)).not.toThrow();
  });
});

describe("LIVE_LISTEN_AUDIO_CONSTRAINTS", () => {
  it("requests audio only", () => {
    expect(LIVE_LISTEN_AUDIO_CONSTRAINTS.video).toBe(false);
    expect(LIVE_LISTEN_AUDIO_CONSTRAINTS.audio).toEqual(
      expect.objectContaining({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      }),
    );
  });
});

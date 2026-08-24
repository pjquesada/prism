import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CaptureMusicStatusPanel } from "@/components/capture-music-status";

describe("CaptureMusicStatusPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a recoverable denied-permission path for browser capture", () => {
    const onRetry = vi.fn();
    const onUseDemoTrack = vi.fn();
    const onUseMicrophone = vi.fn();
    render(
      <CaptureMusicStatusPanel
        status="denied"
        source="browser"
        errorMessage="Capture was blocked or denied. Try again, or use Microphone / Demo Track."
        onRetry={onRetry}
        onUseDemoTrack={onUseDemoTrack}
        onUseMicrophone={onUseMicrophone}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/blocked or denied/i);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /use microphone/i }));
    expect(onUseMicrophone).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /use demo track/i }));
    expect(onUseDemoTrack).toHaveBeenCalled();
  });

  it("distinguishes waiting for audio from music detected and shows a meter", () => {
    const { rerender } = render(
      <CaptureMusicStatusPanel
        status="waiting"
        source="browser"
        hasSound={false}
        inputLevel={0.01}
        onRetry={vi.fn()}
        onUseDemoTrack={vi.fn()}
      />,
    );
    expect(screen.getByTestId("capture-music-status").getAttribute("data-live-listen-detail")).toBe(
      "waiting",
    );
    expect(screen.getByTestId("capture-music-status").textContent).toMatch(/waiting for audio/i);
    expect(screen.getByTestId("capture-music-meter")).toBeTruthy();
    rerender(
      <CaptureMusicStatusPanel
        status="listening"
        source="browser"
        hasSound
        inputLevel={0.4}
        onRetry={vi.fn()}
        onUseDemoTrack={vi.fn()}
      />,
    );
    expect(screen.getByTestId("capture-music-status").getAttribute("data-live-listen-detail")).toBe(
      "sound",
    );
    expect(screen.getByTestId("capture-music-status").textContent).toMatch(/music detected/i);
  });

  it("surfaces no-audio shared source with recovery actions", () => {
    render(
      <CaptureMusicStatusPanel
        status="no_audio"
        source="browser"
        errorMessage="No audio was shared. Try again and make sure Share tab audio or Share system audio is enabled."
        onRetry={vi.fn()}
        onUseDemoTrack={vi.fn()}
        onUseMicrophone={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/No audio was shared/i);
  });

  it("surfaces requesting permission without recovery actions", () => {
    render(
      <CaptureMusicStatusPanel
        status="requesting"
        source="browser"
        onRetry={vi.fn()}
        onUseDemoTrack={vi.fn()}
      />,
    );
    expect(screen.getByTestId("capture-music-status").textContent).toMatch(
      /requesting browser permission/i,
    );
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});

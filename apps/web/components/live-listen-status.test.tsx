import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveListenStatusPanel } from "@/components/live-listen-status";

describe("LiveListenStatusPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a recoverable denied-permission path", () => {
    const onRetry = vi.fn();
    const onUseDemoTrack = vi.fn();
    render(
      <LiveListenStatusPanel
        status="denied"
        errorMessage="Microphone permission was denied. Allow the microphone for this site, then try again."
        onRetry={onRetry}
        onUseDemoTrack={onUseDemoTrack}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/permission was denied/i);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /use demo track/i }));
    expect(onUseDemoTrack).toHaveBeenCalled();
  });

  it("distinguishes waiting for sound from sound detected and shows a meter", () => {
    const { rerender } = render(
      <LiveListenStatusPanel
        status="listening"
        hasSound={false}
        inputLevel={0.01}
        onRetry={vi.fn()}
        onUseDemoTrack={vi.fn()}
      />,
    );
    expect(screen.getByTestId("live-listen-status").getAttribute("data-live-listen-detail")).toBe(
      "waiting",
    );
    expect(screen.getByTestId("live-listen-status").textContent).toMatch(/waiting for sound/i);
    expect(screen.getByTestId("live-listen-meter")).toBeTruthy();
    rerender(
      <LiveListenStatusPanel
        status="listening"
        hasSound
        inputLevel={0.4}
        onRetry={vi.fn()}
        onUseDemoTrack={vi.fn()}
      />,
    );
    expect(screen.getByTestId("live-listen-status").getAttribute("data-live-listen-detail")).toBe(
      "sound",
    );
    expect(screen.getByTestId("live-listen-status").textContent).toMatch(/sound detected/i);
  });

  it("surfaces requesting permission without recovery actions", () => {
    render(
      <LiveListenStatusPanel status="requesting" onRetry={vi.fn()} onUseDemoTrack={vi.fn()} />,
    );
    expect(screen.getByTestId("live-listen-status").textContent).toMatch(/requesting microphone/i);
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});

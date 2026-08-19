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
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  InputDiagnosticsPanel,
  buildInputDiagnosticReport,
} from "@/components/input-diagnostics-panel";

describe("InputDiagnosticsPanel", () => {
  it("builds a sanitized diagnostic report", () => {
    const report = buildInputDiagnosticReport({
      commit: "abc123",
      browserName: "Edge",
      browserVersion: "120",
      operatingSystem: "Win32",
      metrics: {
        inputMode: "browser_capture",
        capturePermissionResult: "listening",
        realtimeConnectionStatus: "connected",
        envelopesPublishedPerSecond: 12,
      },
      analysis: {
        generation: 1,
        audioContextState: "running",
        audioContextSampleRate: 48_000,
        fftSize: 2048,
        smoothingTimeConstant: 0.35,
        track: {
          present: true,
          enabled: true,
          muted: false,
          readyState: "live",
          settings: { sampleRate: 48_000, deviceId: "secret-id" },
        },
        loop: {
          active: true,
          samplesPerSecond: 30,
          framesPerSecond: 20,
          currentRms: 0.12,
          peakRms: 0.2,
          currentEnergy: 0.09,
        },
      },
    });
    expect(report).toMatch(/browser=Edge 120/);
    expect(report).toMatch(/currentRms=0.1200/);
    expect(report).not.toMatch(/secret-id|MediaStream|pairing|token|supabase/i);
  });

  it("renders collapsible diagnostics and runs self-test action", async () => {
    const engine = {
      getAnalysisGraph: () => ({
        getDiagnostics: () => ({
          generation: 1,
          audioContextState: "running",
          audioContextSampleRate: 44_100,
          fftSize: 2048,
          smoothingTimeConstant: 0.35,
          track: {
            present: true,
            enabled: true,
            muted: false,
            readyState: "live",
          },
          loop: {
            active: true,
            samplesPerSecond: 30,
            framesPerSecond: 20,
            currentRms: 0.05,
            peakRms: 0.05,
            currentEnergy: 0.04,
          },
        }),
      }),
    };
    render(
      <InputDiagnosticsPanel
        engine={engine as never}
        metrics={{
          inputMode: "browser_capture",
          capturePermissionResult: "listening",
          realtimeConnectionStatus: "connected",
          envelopesPublishedPerSecond: 10,
        }}
        publishFeatures={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /input diagnostics/i }));
    expect(screen.getByText(/Input mode/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId("run-input-self-test"));
  });
});

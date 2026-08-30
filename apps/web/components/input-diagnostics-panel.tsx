"use client";

import { useCallback, useMemo, useState } from "react";
import {
  derivePipelineStageDiagnostics,
  runMediaStreamInputSelfTest,
  type BrowserCaptureEngine,
  type InputPipelineStageDiagnostics,
  type InputSelfTestResult,
  type LiveListenEngine,
  type MediaStreamAnalysisDiagnostics,
} from "@prism/audio-engine";
import type {
  AudioFeatureEnvelope,
  FeatureDeliveryPath,
  RealtimeChannelState,
} from "@prism/contracts";
import { audioFeatureFrameToEnvelope } from "@prism/contracts";

import type { FeaturePublishOutcome } from "@/lib/session/feature-transport-metrics";

export type InputDiagnosticsCaptureEngine = BrowserCaptureEngine | LiveListenEngine;

export type InputDiagnosticsMetrics = {
  inputMode: string;
  capturePermissionResult: string;
  restConnectionStatus: string;
  realtimeChannelState: RealtimeChannelState;
  framesGeneratedPerSecond: number;
  publicationAttemptsPerSecond: number;
  serverAcceptedPerSecond: number;
  publicationFailuresPerSecond: number;
  lastPublicationErrorCategory?: string | null;
  realtimeEnvelopesReceivedPerSecond: number;
  fallbackPollsPerSecond: number;
  fallbackEnvelopesReceivedPerSecond: number;
  lastReceivedFrameSeq?: number;
  msSinceLastDisplayReceipt?: number | null;
  deliveryPath: FeatureDeliveryPath;
  lastDisplayAckFrameSeq?: number | null;
  lastDisplayAckAtMs?: number | null;
  lastDisplayAckTransport?: string | null;
  lastErrorCategory?: string | null;
};

type InputDiagnosticsPanelProps = {
  engine: InputDiagnosticsCaptureEngine | null;
  metrics: InputDiagnosticsMetrics;
  publishFeatures?: (envelope: AudioFeatureEnvelope) => Promise<FeaturePublishOutcome> | void;
  observeDisplayReceipt?: () => number;
};

function stageClass(
  status: InputPipelineStageDiagnostics[keyof InputPipelineStageDiagnostics],
): string {
  switch (status) {
    case "healthy":
      return "text-emerald-300";
    case "failed":
      return "text-prism-ember";
    case "waiting":
      return "text-amber-200";
    default:
      return "text-prism-mist";
  }
}

function sanitizeSettings(settings?: MediaTrackSettings): Record<string, unknown> | undefined {
  if (!settings) return undefined;
  const sanitized = { ...settings } as Record<string, unknown>;
  delete sanitized.deviceId;
  delete sanitized.groupId;
  return sanitized;
}

export function buildInputDiagnosticReport(input: {
  commit?: string;
  browserName: string;
  browserVersion: string;
  operatingSystem: string;
  metrics: InputDiagnosticsMetrics;
  analysis?: MediaStreamAnalysisDiagnostics;
  stages?: InputPipelineStageDiagnostics;
  selfTest?: InputSelfTestResult | null;
}): string {
  const lines = [
    "Prism Input Diagnostics",
    `version=${input.commit ?? "unknown"}`,
    `browser=${input.browserName} ${input.browserVersion}`,
    `os=${input.operatingSystem}`,
    `inputMode=${input.metrics.inputMode}`,
    `capturePermission=${input.metrics.capturePermissionResult}`,
    `audioTracks=${input.analysis?.track.present ? 1 : 0}`,
    `trackEnabled=${input.analysis?.track.enabled ?? false}`,
    `trackMuted=${input.analysis?.track.muted ?? false}`,
    `trackReadyState=${input.analysis?.track.readyState ?? "none"}`,
    `trackSettings=${JSON.stringify(sanitizeSettings(input.analysis?.track.settings) ?? {})}`,
    `trackConstraints=${JSON.stringify(input.analysis?.track.constraints ?? {})}`,
    `trackCapabilities=${JSON.stringify(input.analysis?.track.capabilities ?? {})}`,
    `audioContextState=${input.analysis?.audioContextState ?? "none"}`,
    `audioContextSampleRate=${input.analysis?.audioContextSampleRate ?? 0}`,
    `analyserFftSize=${input.analysis?.fftSize ?? 0}`,
    `analyserSmoothing=${input.analysis?.smoothingTimeConstant ?? 0}`,
    `samplingLoopActive=${input.analysis?.loop.active ?? false}`,
    `samplesPerSecond=${Math.round(input.analysis?.loop.samplesPerSecond ?? 0)}`,
    `currentRms=${(input.analysis?.loop.currentRms ?? 0).toFixed(4)}`,
    `peakRms=${(input.analysis?.loop.peakRms ?? 0).toFixed(4)}`,
    `currentEnergy=${(input.analysis?.loop.currentEnergy ?? 0).toFixed(4)}`,
    `featureFramesPerSecond=${Math.round(input.analysis?.loop.framesPerSecond ?? 0)}`,
    `framesGeneratedPerSecond=${Math.round(input.metrics.framesGeneratedPerSecond)}`,
    `publicationAttemptsPerSecond=${Math.round(input.metrics.publicationAttemptsPerSecond)}`,
    `serverAcceptedPerSecond=${Math.round(input.metrics.serverAcceptedPerSecond)}`,
    `publicationFailuresPerSecond=${Math.round(input.metrics.publicationFailuresPerSecond)}`,
    `restConnection=${input.metrics.restConnectionStatus}`,
    `realtimeChannelState=${input.metrics.realtimeChannelState}`,
    `realtimeEnvelopesReceivedPerSecond=${Math.round(input.metrics.realtimeEnvelopesReceivedPerSecond)}`,
    `fallbackPollsPerSecond=${Math.round(input.metrics.fallbackPollsPerSecond)}`,
    `fallbackEnvelopesReceivedPerSecond=${Math.round(input.metrics.fallbackEnvelopesReceivedPerSecond)}`,
    `lastReceivedFrameSeq=${input.metrics.lastReceivedFrameSeq ?? -1}`,
    `msSinceLastDisplayReceipt=${input.metrics.msSinceLastDisplayReceipt ?? "none"}`,
    `deliveryPath=${input.metrics.deliveryPath}`,
    `lastDisplayAckFrameSeq=${input.metrics.lastDisplayAckFrameSeq ?? "none"}`,
    `lastDisplayAckTransport=${input.metrics.lastDisplayAckTransport ?? "none"}`,
    `lastPublicationErrorCategory=${input.metrics.lastPublicationErrorCategory ?? "none"}`,
    `lastErrorCategory=${input.metrics.lastErrorCategory ?? "none"}`,
  ];
  if (input.stages) {
    lines.push(
      `stageAudioTrack=${input.stages.audioTrack}`,
      `stageAudioContext=${input.stages.audioContext}`,
      `stageAnalyser=${input.stages.analyserSamples}`,
      `stageFeatureExtraction=${input.stages.featureExtraction}`,
      `stagePublication=${input.stages.featurePublication}`,
      `stageDisplayReceipt=${input.stages.displayReceipt}`,
    );
  }
  if (input.selfTest) {
    lines.push(
      `selfTestOk=${input.selfTest.ok}`,
      `selfTestPeakRms=${input.selfTest.peakRms.toFixed(4)}`,
      `selfTestPeakEnergy=${input.selfTest.peakEnergy.toFixed(4)}`,
    );
  }
  return lines.join("\n");
}

function detectBrowser(): { name: string; version: string; os: string } {
  if (typeof navigator === "undefined") {
    return { name: "unknown", version: "unknown", os: "unknown" };
  }
  const ua = navigator.userAgent ?? "";
  const platform = navigator.platform || "unknown";
  const edge = ua.match(/Edg\/([\d.]+)/);
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  const firefox = ua.match(/Firefox\/([\d.]+)/);
  const safari = ua.match(/Version\/([\d.]+).*Safari/);
  if (edge) return { name: "Edge", version: edge[1] ?? "unknown", os: platform };
  if (chrome) return { name: "Chrome", version: chrome[1] ?? "unknown", os: platform };
  if (firefox) return { name: "Firefox", version: firefox[1] ?? "unknown", os: platform };
  if (safari) return { name: "Safari", version: safari[1] ?? "unknown", os: platform };
  return { name: "unknown", version: "unknown", os: "unknown" };
}

export function InputDiagnosticsPanel({
  engine,
  metrics,
  publishFeatures,
  observeDisplayReceipt,
}: InputDiagnosticsPanelProps) {
  const [open, setOpen] = useState(false);
  const [selfTest, setSelfTest] = useState<InputSelfTestResult | null>(null);
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const analysis = engine?.getAnalysisGraph?.()?.getDiagnostics();
  const stages = useMemo(
    () =>
      derivePipelineStageDiagnostics({
        track: analysis?.track ?? {
          present: false,
          enabled: false,
          muted: false,
          readyState: "none",
        },
        audioContextState: analysis?.audioContextState ?? "none",
        loopActive: analysis?.loop.active ?? false,
        currentRms: analysis?.loop.currentRms ?? 0,
        currentEnergy: analysis?.loop.currentEnergy ?? 0,
        serverAcceptedPerSecond: metrics.serverAcceptedPerSecond,
        displayReceiptHealthy:
          (metrics.realtimeEnvelopesReceivedPerSecond ?? 0) +
            (metrics.fallbackEnvelopesReceivedPerSecond ?? 0) >
          0,
        hasDisplayPaired: metrics.lastDisplayAckFrameSeq !== null,
        displayAckRecent:
          metrics.lastDisplayAckAtMs !== null &&
          metrics.lastDisplayAckAtMs !== undefined &&
          (metrics.msSinceLastDisplayReceipt ?? Number.MAX_SAFE_INTEGER) < 3_000,
      }),
    [analysis, metrics],
  );

  const browser = detectBrowser();
  const commit =
    typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "dev")
      : "dev";

  const copyReport = useCallback(async () => {
    const report = buildInputDiagnosticReport({
      commit,
      browserName: browser.name,
      browserVersion: browser.version,
      operatingSystem: browser.os,
      metrics,
      analysis,
      stages,
      selfTest,
    });
    try {
      await navigator.clipboard.writeText(report);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }, [analysis, browser.name, browser.os, browser.version, commit, metrics, selfTest, stages]);

  const runSelfTest = useCallback(async () => {
    setSelfTestRunning(true);
    try {
      const result = await runMediaStreamInputSelfTest({
        publish: publishFeatures
          ? async (frame) => {
              const envelope = audioFeatureFrameToEnvelope(frame, 1, Date.now());
              const outcome = await publishFeatures(envelope);
              if (!outcome || typeof outcome !== "object" || !("ok" in outcome)) return false;
              return outcome.ok === true;
            }
          : undefined,
        observeDisplay: observeDisplayReceipt,
      });
      setSelfTest(result);
    } finally {
      setSelfTestRunning(false);
    }
  }, [observeDisplayReceipt, publishFeatures]);

  return (
    <div
      className="rounded-sm border border-prism-slate/80 bg-prism-ink/80 p-4"
      data-testid="input-diagnostics"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-sm text-prism-foam"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Input diagnostics</span>
        <span className="text-prism-mist">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="mt-4 flex flex-col gap-4 text-sm text-prism-mist">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide">Input mode</dt>
              <dd>{metrics.inputMode}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Permission</dt>
              <dd>{metrics.capturePermissionResult}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Audio track</dt>
              <dd>
                {analysis?.track.present
                  ? `${analysis.track.readyState}, enabled=${String(analysis.track.enabled)}, muted=${String(analysis.track.muted)}`
                  : "none"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">AudioContext</dt>
              <dd>
                {analysis?.audioContextState ?? "none"} @ {analysis?.audioContextSampleRate ?? 0} Hz
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">RMS / energy</dt>
              <dd>
                {(analysis?.loop.currentRms ?? 0).toFixed(3)} /{" "}
                {(analysis?.loop.currentEnergy ?? 0).toFixed(3)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Feature / server ack</dt>
              <dd>
                {Math.round(analysis?.loop.framesPerSecond ?? 0)} fps ·{" "}
                {Math.round(metrics.serverAcceptedPerSecond)} ack/s
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Realtime channel</dt>
              <dd>{metrics.realtimeChannelState}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Delivery path</dt>
              <dd>{metrics.deliveryPath}</dd>
            </div>
          </dl>

          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-prism-foam">Pipeline stages</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {(
                Object.entries(stages) as Array<
                  [
                    keyof InputPipelineStageDiagnostics,
                    InputPipelineStageDiagnostics[keyof InputPipelineStageDiagnostics],
                  ]
                >
              ).map(([stage, status]) => (
                <li key={stage} className={stageClass(status)} data-testid={`input-stage-${stage}`}>
                  {stage}: {status}
                </li>
              ))}
            </ul>
          </div>

          {selfTest ? (
            <div data-testid="input-self-test-result">
              <p className="text-prism-foam">
                Self-test {selfTest.ok ? "passed" : "failed"} · peak RMS{" "}
                {selfTest.peakRms.toFixed(3)}
              </p>
              <ul className="mt-2 grid gap-1">
                {selfTest.stages.map((stage) => (
                  <li key={stage.stage}>
                    {stage.stage}: {stage.status} — {stage.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="prism-btn prism-btn-ghost"
              onClick={() => void copyReport()}
            >
              Copy diagnostic report
            </button>
            <button
              type="button"
              className="prism-btn prism-btn-primary"
              disabled={selfTestRunning}
              data-testid="run-input-self-test"
              onClick={() => void runSelfTest()}
            >
              {selfTestRunning ? "Running self-test…" : "Run input self-test"}
            </button>
          </div>
          {copyState === "copied" ? <p role="status">Diagnostic report copied.</p> : null}
          {copyState === "failed" ? (
            <p className="text-prism-ember" role="alert">
              Could not copy the diagnostic report.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

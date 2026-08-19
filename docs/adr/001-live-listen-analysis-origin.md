# ADR 001 — Live Listen feature-frame origin

Status: Accepted (Phase 1E)
Date: 2026-08-19

## Context

Build spec §24 deferred: whether Live Listen feature frames are always controller-originated vs display-local analysis in multi-device setups.

Constraints:

- Microphone audio must never be recorded, saved, uploaded, or transmitted.
- Only numeric feature frames may cross process or network boundaries.
- Phase 1D session payloads forbid `audio`, `pcm`, `microphone`, `fft`, `bands`, and related keys.
- Spec §10.3 mentions a throttled `audio.features` message, but Phase 1D explicitly did not put FFT/`bands` on the wire.

## Decision

**Live Listen analysis is device-local.** The device that granted microphone permission extracts numeric `AudioFeatureFrame`s in `packages/audio-engine` and feeds them to the local visualizer.

- Combined `/app` and `/demo` run Live Listen entirely on that browser.
- In a paired session, the **audio authority** (controller or combined) may switch `playback.audioMode` to `live_listen`. That device captures the mic.
- **Follower displays do not capture a microphone** and do not receive PCM, FFT arrays, or `bands`. They keep visualizer/preset sync and render a silent/ambient feature frame, with copy explaining that Live Listen is local to the controller.

Compact numeric envelopes over the session channel (`audio.features` without `bands`) are **deferred**. They would help remote displays react to the controller’s room, but they are not required to meet Phase 1E acceptance (local visualization, no audio bytes on the wire, recoverable permission denial).

## Consequences

- Multi-display Live Listen will not share the controller’s ambient energy until a later, explicit compact-envelope protocol is approved.
- Displays remain safe: no mic prompt, no audio bytes.
- Existing Demo Track multi-display sync is unchanged (`audioMode: "demo_track"`).

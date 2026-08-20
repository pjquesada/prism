# ADR 001 — Live Listen feature-frame origin

Status: Accepted (Phase 1E stabilization)
Date: 2026-08-19
Updated: 2026-08-19

## Context

Build spec §24 deferred: whether Live Listen feature frames are always controller-originated vs display-local analysis in multi-device setups.

Constraints:

- Microphone audio must never be recorded, saved, uploaded, or transmitted.
- Only numeric feature frames may cross process or network boundaries.
- Phase 1D session payloads forbid `pcm`, `microphone`, `fft`, `bands`, and related keys.
- Spec §10.3 requires a throttled `audio.features` message.

## Decision

**Microphone capture and PCM/FFT analysis remain entirely on the controller (or combined) device.**

- Combined `/app` and `/demo` run Live Listen entirely on that browser.
- In a paired session, only an authenticated controller/combined device may capture the mic **or** play Demo Track audio.
- **Follower displays never request microphone permission**, never instantiate a Demo Track audio graph, and never receive PCM, FFT arrays, or `bands`.
- The controller publishes a compact `audio.features` envelope on the authenticated session channel for **both** Demo Track and Live Listen:
  - `frameSeq`, `timestampMs`
  - `rms`, `energy`, `bass`, `mid`, `high`
  - 8 normalized `levels` (not FFT bins)
  - `onset`, `beatStrength`, `centroid`
- Maximum publish rate is **20 Hz**.
- Envelopes are **not** written to database tables.
- Displays interpolate incoming envelopes on the visualizer `requestAnimationFrame` loop and decay to silence if frames stop.

## Consequences

- Remote displays can react to the controller’s room energy or Demo Track without a second mic prompt or duplicate audio.
- Raw FFT, PCM, MediaStream data, and secrets stay off the wire.

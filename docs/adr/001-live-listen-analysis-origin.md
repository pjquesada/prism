# ADR 001 — Capture Music feature-frame origin

Status: Accepted (Phase 1E input-capture stabilization)
Date: 2026-08-19
Updated: 2026-08-23

## Context

Build spec §24 deferred: whether Live Listen / Capture Music feature frames are always controller-originated vs display-local analysis in multi-device setups.

Constraints:

- Captured browser/system audio and microphone audio must never be recorded, saved, uploaded, or transmitted.
- Video from `getDisplayMedia` must never be rendered, encoded, transmitted, recorded, or persisted.
- Only numeric feature frames may cross process or network boundaries.
- Phase 1D session payloads forbid `pcm`, `microphone`, `fft`, `bands`, and related keys.
- Spec §10.3 requires a throttled `audio.features` message.

## Decision

**Capture and PCM/FFT analysis remain entirely on the controller (or combined) device.**

- Primary input is **Capture Music** via `navigator.mediaDevices.getDisplayMedia()` (tab/system audio).
- **Microphone** remains an optional fallback using `getUserMedia`.
- **Demo Track** remains local royalty-free playback + analysis.
- Combined `/app` and `/demo` run Capture Music entirely on that browser.
- In a paired session, only an authenticated controller/combined device may capture audio **or** play Demo Track audio.
- **Follower displays never** call `getDisplayMedia` or `getUserMedia`, never instantiate a Demo Track audio graph, and never receive PCM, FFT arrays, or `bands`.
- While the local role is unresolved, Prism defaults to **no capture and no audio output**.
- The controller publishes a compact `audio.features` envelope on the authenticated session channel for Demo Track and Capture Music:
  - `frameSeq`, `timestampMs`
  - `rms`, `energy`, `bass`, `mid`, `high`
  - 8 normalized `levels` (not FFT bins)
  - `onset`, `beatStrength`, `centroid`
- Maximum publish rate is **20 Hz**.
- Envelopes are **not** written to database tables.
- Displays interpolate incoming envelopes on the visualizer `requestAnimationFrame` loop and decay to silence if frames stop.
- Captured audio is never connected to `AudioContext.destination` (no echo / second playback path).
- `MediaRecorder` is never used.

## Wire protocol note

Session `playback.audioMode` continues to use `live_listen` for Capture Music and Microphone so existing sessions stay compatible. Product copy uses **Capture Music**.

## Consequences

- Remote displays react to the controller’s music energy or Demo Track without a second permission prompt or duplicate audio.
- Raw FFT, PCM, MediaStream, video frames, and secrets stay off the wire.
- Stale PWA caches that previously played display audio are replaced through a versioned service worker with an explicit **Update available — Reload** prompt (no silent mid-session `skipWaiting`).

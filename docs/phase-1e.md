# Phase 1E — Live Listen

## Goals delivered

- `LiveListenEngine` in `packages/audio-engine`: `getUserMedia` → `AnalyserNode` feature extraction only
- Microphone is never connected to speakers (no monitor/feedback path)
- Tracks, analyser, and AudioContext are stopped/closed on pause-dispose and unmount
- Combined `/app` and `/demo` can switch Demo Track ↔ Live Listen
- Session controllers can set `playback.audioMode` to `live_listen`
- Compact `audio.features` envelopes (20 Hz max) sync visualization levels to paired displays for **both** Demo Track and Live Listen
- Displays interpolate envelopes at `requestAnimationFrame` and decay to silence; they never request a microphone or play session audio
- Permission denied / unavailable / unsupported / inactive / error states with Try again and Use Demo Track
- Controller input-level meter plus Listening — sound detected / waiting for sound
- Display visualizers fill the available stage (`100dvh`, safe-area insets, DPR-backed canvas resize)
- Feature flag: `NEXT_PUBLIC_ENABLE_LIVE_LISTEN` (disabled only when set to `false`)
- ADR: analysis stays on the controller; only anonymous numeric levels are shared

## Audio ownership

| Mode            | Audio output    | Microphone access               | Feature producer                    |
| --------------- | --------------- | ------------------------------- | ----------------------------------- |
| Controller only | Controller only | Controller only for Live Listen | Controller                          |
| Display only    | Silent          | Never                           | Never; consumes controller features |
| Combined        | Local device    | Local device for Live Listen    | Local device                        |
| Demo standalone | Local device    | Only when Live Listen selected  | Local device                        |

Display-only devices must not construct `DemoTrackEngine` or `LiveListenEngine`, must not call `getUserMedia`, and must not connect an analyser to `AudioContext.destination`.

## Render path

- Network envelopes stay at ≤ 20 Hz.
- Visualizers render on one `requestAnimationFrame` loop (R3F `useFrame`) with timestamp-aware interpolation (fast attack, slower release).
- Feature frames are stored in refs / the interpolator, not React state.
- Snapshot HTTP polling backs off while SSE/Supabase realtime is healthy.
- Hidden tabs pause the canvas (`frameloop="never"`).
- Particle count / post / resolution change only through adaptive quality caps.

## Development performance snapshot

When `NODE_ENV !== "production"` (or `NEXT_PUBLIC_PRISM_PERF=1`), `window.__PRISM_PERF__` reports approximate FPS, feature Hz, dropped/stale frames, animation loops, AudioContext/source counts, and realtime subscriptions. It never includes samples, FFT arrays, pairing codes, or secrets.

## Out of scope (confirmed)

- Manual Sync, Ambient generative profiles, Dreamscape / AI, provider OAuth, Android TV, Phase 1F

## Manual checks

1. `pnpm install && pnpm build`
2. Open `/demo` or `/app`, select **Live Listen**, allow the microphone, confirm the visualizer reacts and the input meter moves
3. Deny permission → recovery copy, **Try again**, **Use Demo Track**
4. Leave the page — microphone indicator turns off
5. Pair a PC controller with a phone display: Demo Track audio on the PC only; phone is silent and interpolates envelopes
6. Controller Live Listen; display reacts without a mic prompt
7. Confirm the display canvas fills the bordered stage (no shallow strip)

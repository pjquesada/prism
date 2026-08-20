# Phase 1E — Live Listen

## Goals delivered

- `LiveListenEngine` in `packages/audio-engine`: `getUserMedia` → `AnalyserNode` feature extraction only
- Microphone is never connected to speakers (no monitor/feedback path)
- Tracks, analyser, and AudioContext are stopped/closed on pause-dispose and unmount
- Combined `/app` and `/demo` can switch Demo Track ↔ Live Listen
- Session controllers can set `playback.audioMode` to `live_listen`
- Compact `audio.features` envelopes (20 Hz max) sync visualization levels to paired displays
- Displays interpolate envelopes and decay to silence; they never request a microphone
- Permission denied / unavailable / unsupported / inactive / error states with Try again and Use Demo Track
- Display visualizers fill the available stage (`100dvh`, safe-area insets, DPR-backed canvas resize)
- Feature flag: `NEXT_PUBLIC_ENABLE_LIVE_LISTEN` (disabled only when set to `false`)
- ADR: analysis stays on the controller; only anonymous numeric levels are shared

## Out of scope (confirmed)

- Manual Sync, Ambient generative profiles, Dreamscape / AI, provider OAuth, Android TV, Phase 1F

## Manual checks

1. `pnpm install && pnpm build`
2. Open `/demo` or `/app`, select **Live Listen**, allow the microphone, confirm the visualizer reacts
3. Deny permission → recovery copy, **Try again**, **Use Demo Track**
4. Leave the page — microphone indicator turns off
5. Pair a PC controller with a phone display: controller Live Listen; display reacts without a mic prompt
6. Confirm the display canvas fills the bordered stage (no shallow strip)

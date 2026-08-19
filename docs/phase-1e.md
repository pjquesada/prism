# Phase 1E — Live Listen

## Goals delivered

- `LiveListenEngine` in `packages/audio-engine`: `getUserMedia` → `AnalyserNode` feature extraction only
- Microphone is never connected to speakers (no monitor/feedback path)
- Tracks, analyser, and AudioContext are stopped/closed on pause-dispose and unmount
- Combined `/app` and `/demo` can switch Demo Track ↔ Live Listen
- Session controllers can set `playback.audioMode` to `live_listen`; displays follow visual intent without capturing a mic
- Permission denied / unavailable / unsupported / error states with Try again and Use Demo Track
- Feature flag: `NEXT_PUBLIC_ENABLE_LIVE_LISTEN` (disabled only when set to `false`)
- ADR: Live Listen analysis is device-local; no PCM/FFT/`bands` on the session wire

## Out of scope (confirmed)

- Transmitting compact `audio.features` envelopes to remote displays
- Manual Sync, Ambient generative profiles, Dreamscape / AI, provider OAuth, Android TV

## Manual checks

1. `pnpm install && pnpm build`
2. Open `/demo` or `/app`, select **Live Listen**, allow the microphone, confirm the visualizer reacts
3. Deny permission → recovery copy, **Try again**, **Use Demo Track**
4. Leave the page — microphone indicator turns off
5. In a paired session, controller Live Listen; display shows follower copy and does not prompt for a mic

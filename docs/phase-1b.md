# Phase 1B — Demo audio and Spectrum visualizer

## Goals delivered

- `packages/audio-engine` — Demo Track playback + local feature frames (Web Audio)
- `packages/visual-engine` — R3F canvas host + visualizer plugin contract
- `packages/visualizers` — Spectrum plugin (Three.js)
- Combined `/app` and local `/demo` play Demo Track with reactive Spectrum
- Royalty-free generated Demo Track with documented provenance
- Loading / unsupported / audio-error / WebGL fallback states
- Resource disposal for audio graph, rAF, and Three resources

## Out of scope (confirmed)

Microphone / Live Listen, sync-engine, Supabase, providers, AI, additional visualizers, Android TV.

## Manual checks

1. `pnpm install && pnpm build`
2. Open `/demo` and `/app`, press **Play**, confirm Spectrum reacts
3. Navigate away and back — no lingering audio
4. Production SW: revisit offline after first load (Demo Track cache)
5. `prefers-reduced-motion: reduce` — tempered motion, no strobing

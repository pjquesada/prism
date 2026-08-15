# Phase 1C — Particles, Album World, presets, and adaptive quality

## Goals delivered

- Particles visualizer with pooled particles (bass / mid / high / beat bursts)
- Album World visualizer with local placeholder art, optional local file art, palette extraction, parallax
- Versioned Zod preset schemas, immutable built-ins, guest `localStorage` persistence
- Duplicate / edit / reset / save / delete + live preview
- Adaptive quality manager (DPR caps, resolution scale, particle caps, FPS targets, hysteresis)
- In-place visualizer switching on a single R3F canvas / render loop
- Reduced-motion and photosensitivity-tempered motion
- Loading, artwork-error, local-storage-error, unsupported, and WebGL fallback states

## Out of scope (confirmed)

Supabase, accounts, OAuth, provider integrations, microphone / Live Listen, realtime sessions, AI / Dreamscape, Android TV.

## Manual checks

1. `pnpm install && pnpm build`
2. Open `/demo`, press **Play**, switch Spectrum → Particles → Album World (one canvas)
3. Album World: clear art uses placeholder; invalid file shows error + placeholder
4. Save a guest preset, reload, confirm it restores; built-ins remain undeletable
5. Quality Auto under load should step down; manual tiers force a fixed cap
6. `prefers-reduced-motion: reduce` — tempered motion, no strobing bursts

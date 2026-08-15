# Phase 1D — Sessions and device pairing

## Goals delivered

- Guest session create / join with six-character codes + QR join URLs
- Routes: `/start`, `/join`, `/controller/[sessionId]`, `/display/[sessionId]`
- In-memory session backend for local/CI (no production Supabase required)
- Optional Supabase schema + RLS migrations under `supabase/migrations`
- `packages/sync-engine` — clock, seq, playback projection, drift correction, reducers
- `packages/db` — typed helpers; admin client server-only
- Zod-validated session event envelopes; snapshot + incremental sync
- Controller / Display / Combined roles, Mirror / Complementary modes, handoff
- Heartbeat, presence, reconnect via SSE memory transport
- Explicit prohibition: no raw audio, mic audio, FFT/`bands`, or images on the wire

## Route map vs build-spec §6

| This phase                | Spec alias                                |
| ------------------------- | ----------------------------------------- |
| `/start`                  | session create / pair UI                  |
| `/join?code=`             | `/pair` + `/pair/[code]`                  |
| `/controller/[sessionId]` | `/controller`                             |
| `/display/[sessionId]`    | `/display`                                |
| `/app`                    | local Combined Demo (Phase 1C; preserved) |

## Wire protocol note

Build-spec §10 lists `audio.features`. Phase 1D **does not** transmit feature frames or FFT arrays. Displays analyze Demo Track locally and follow playback anchors + visual intent only.

## Out of scope (confirmed)

Live Listen / microphone, Dreamscape / AI, provider OAuth, Android TV, full user accounts.

## Manual checks

1. `pnpm install && pnpm build`
2. Open `/start` → Start guest session → note code/QR
3. Second browser / phone: `/join` with code → display updates when controller switches visualizer
4. Toggle Mirror / Complementary; hand off controller; end session
5. Without Supabase env, Demo routes (`/demo`, `/app`) still work
6. Apply `supabase/migrations/20260815000000_phase1d_sessions.sql` when you create a project

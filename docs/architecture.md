# Prism architecture (Phase 1E snapshot)

## Shape

Prism is a pnpm + Turborepo monorepo. Apps orchestrate; packages implement bounded domains.

| Path                     | Role in 1D                                                       |
| ------------------------ | ---------------------------------------------------------------- |
| `apps/web`               | Next.js PWA + session routes / APIs                              |
| `packages/audio-engine`  | Demo Track + Live Listen analysis; remote envelope interpolation |
| `packages/visual-engine` | R3F canvas host, adaptive quality                                |
| `packages/visualizers`   | Spectrum, Particles, Album World                                 |
| `packages/sync-engine`   | Session clock, seq, playback projection, reducers                |
| `packages/db`            | Supabase client helpers + schema types                           |
| `packages/contracts`     | Zod domain + session protocol                                    |
| `packages/config`        | Shared tooling                                                   |
| `packages/ui`            | Stub accessible UI primitives                                    |
| `supabase/migrations`    | Guest sessions, pairing, playback, preset snapshots, RLS         |

## Routes

| Route                     | Role                                      |
| ------------------------- | ----------------------------------------- |
| `/`                       | Brand entry                               |
| `/start`                  | Create guest session, show code/QR        |
| `/join`                   | Redeem pairing code / QR                  |
| `/controller/[sessionId]` | Controller chrome + optional local canvas |
| `/display/[sessionId]`    | Immersive display follower                |
| `/demo`                   | Local Demo Track (no network session)     |
| `/app`                    | Local Combined Demo                       |
| `/presets`                | Guest-local presets                       |
| `/offline`                | PWA offline fallback                      |

## Runtime

- **Production:** Supabase service role + `SESSION_SIGNING_SECRET`; HTTP APIs persist HMAC pairing digests and credential digests. Missing secrets fail closed.
- **Local/tests:** `PRISM_SESSION_BACKEND=memory` (explicit) + signing secret; SSE fanout for session messages plus snapshot polling
- Microphone PCM, raw FFT arrays, `bands`, MediaStream data, and secrets are never transmitted. Compact `audio.features` envelopes (`energy`, 8 `levels`, onset, centroid) may be published at ≤20 Hz on the authenticated session channel; they are not persisted.

## Validation

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @prism/web exec playwright install chromium
pnpm --filter @prism/web test:e2e
```

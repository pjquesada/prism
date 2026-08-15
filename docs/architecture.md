# Prism architecture (Phase 1C snapshot)

## Shape

Prism is a pnpm + Turborepo monorepo. Apps orchestrate; packages implement bounded domains.

| Path                     | Role in 1C                                                              |
| ------------------------ | ----------------------------------------------------------------------- |
| `apps/web`               | Next.js App Router PWA (`/`, `/demo`, `/app`, `/presets`, `/offline`)   |
| `packages/audio-engine`  | Demo Track playback + local `AudioFeatureFrame` extraction              |
| `packages/visual-engine` | R3F canvas host, adaptive quality, `VisualizerPlugin` contract          |
| `packages/visualizers`   | Spectrum, Particles, Album World plugins                                |
| `packages/config`        | Shared TypeScript, ESLint, Tailwind token helpers                       |
| `packages/contracts`     | Zod domain contracts (params, presets, feature frames)                  |
| `packages/ui`            | Stub accessible UI primitives                                           |

## Intentionally deferred packages

Created in later phases only:

- `sync-engine`, `db`, `supabase/` (1D)
- `provider-adapters`, `ai-adapters` (stub/mock when needed)
- Dreamscape visualizer (1F)
- `apps/android-tv` (1G)

## Route roles

| Route                 | Role                                                      |
| --------------------- | --------------------------------------------------------- |
| `/demo`               | Local Demo Track + Spectrum / Particles / Album World     |
| `/app`                | Combined mode with the same Demo Track experience         |
| `/presets`            | Browse built-in + guest-local presets                     |
| `/presets/[presetId]` | Edit / live-preview a preset (local only)                 |
| `/offline`            | PWA offline fallback                                      |

## Runtime today

Local browser only. Feature frames are not broadcast. Guest presets use `localStorage`. No Supabase realtime, no music OAuth, no microphone capture. Album artwork is placeholder or user-selected local files only (never uploaded).

## Validation

From the repo root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Optional browser smoke (after build):

```bash
pnpm --filter @prism/web exec playwright install chromium
pnpm --filter @prism/web test:e2e
```

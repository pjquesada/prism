# Prism architecture (Phase 1B snapshot)

## Shape

Prism is a pnpm + Turborepo monorepo. Apps orchestrate; packages implement bounded domains.

| Path                     | Role in 1B                                                 |
| ------------------------ | ---------------------------------------------------------- |
| `apps/web`               | Next.js App Router PWA (`/`, `/demo`, `/app`, `/offline`)  |
| `packages/audio-engine`  | Demo Track playback + local `AudioFeatureFrame` extraction |
| `packages/visual-engine` | R3F canvas host + `VisualizerPlugin` contract              |
| `packages/visualizers`   | Spectrum plugin (Three.js)                                 |
| `packages/config`        | Shared TypeScript, ESLint, Tailwind token helpers          |
| `packages/contracts`     | Zod domain contracts (including Spectrum params)           |
| `packages/ui`            | Stub accessible UI primitives                              |

## Intentionally deferred packages

Created in later phases only:

- `sync-engine`, `db`, `supabase/` (1D)
- `provider-adapters`, `ai-adapters` (stub/mock when needed)
- Particles / Album World / Dreamscape visualizers (1C / 1F)
- `apps/android-tv` (1G)

## Route roles

| Route      | Role                                                   |
| ---------- | ------------------------------------------------------ |
| `/demo`    | Local Demo Track + Spectrum                            |
| `/app`     | Combined mode with the same Demo Track + Spectrum path |
| `/offline` | PWA offline fallback                                   |

`/demo` and `/app` are both kept: `/demo` is the dedicated Demo shell; `/app` satisfies Combined-mode acceptance.

## Runtime today

Local browser only. Feature frames are not broadcast. No Supabase realtime, no music OAuth, no microphone capture.

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

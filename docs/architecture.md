# Prism architecture (Phase 1A snapshot)

## Shape

Prism is a pnpm + Turborepo monorepo. Apps orchestrate; packages implement bounded domains.

| Path                 | Role in 1A                                             |
| -------------------- | ------------------------------------------------------ |
| `apps/web`           | Next.js App Router PWA shell (`/`, `/app`, `/offline`) |
| `packages/config`    | Shared TypeScript, ESLint, Tailwind token helpers      |
| `packages/contracts` | Minimal Zod domain contracts                           |
| `packages/ui`        | Stub accessible UI primitives                          |

## Intentionally deferred packages

Created in later phases only:

- `audio-engine`, `visual-engine`, `visualizers` (1B+)
- `sync-engine`, `db`, `supabase/` (1D)
- `provider-adapters`, `ai-adapters` (stub/mock when needed)
- `apps/android-tv` (1G)

## Runtime today

Local browser only. No Supabase realtime, no music OAuth, no microphone capture, no Three.js scenes.

## Validation

From the repo root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

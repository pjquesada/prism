# Prism architecture (Phase 1A snapshot)

## Shape

Prism is a pnpm + Turborepo monorepo. Apps orchestrate; packages implement bounded domains.

| Path                 | Role in 1A                                                      |
| -------------------- | --------------------------------------------------------------- |
| `apps/web`           | Next.js App Router PWA shell (`/`, `/demo`, `/app`, `/offline`) |
| `packages/config`    | Shared TypeScript, ESLint, Tailwind token helpers               |
| `packages/contracts` | Minimal Zod domain contracts                                    |
| `packages/ui`        | Stub accessible UI primitives                                   |

## Intentionally deferred packages

Created in later phases only:

- `audio-engine`, `visual-engine`, `visualizers` (1B+)
- `sync-engine`, `db`, `supabase/` (1D)
- `provider-adapters`, `ai-adapters` (stub/mock when needed)
- `apps/android-tv` (1G)

## Route roles (Phase 1A)

| Route      | Role                                                              |
| ---------- | ----------------------------------------------------------------- |
| `/demo`    | Local-only demo application shell (UI placeholder for Demo Track) |
| `/app`     | Combined mode entry from the build specification                  |
| `/offline` | PWA offline fallback                                              |

`/demo` and `/app` are both kept: `/demo` satisfies the Phase 1A local demo shell; `/app` is a named primary route in the build spec and must not be removed.

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

# Phase 1A — Repository and PWA foundation

## Goals delivered

- pnpm workspaces + Turborepo skeleton
- `apps/web` Next.js App Router + Tailwind + strict TypeScript
- Shared `packages/config`, `packages/contracts` (minimal), `packages/ui` stub
- PWA manifest + Serwist service worker path + `/offline` fallback
- Local-only `/demo` application shell (UI only)
- `.env.example` placeholders
- Root scripts: `format`, `lint`, `typecheck`, `test`, `build`

## Routes

| Route         | Purpose                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `/`           | Brand entry                                                               |
| `/demo`       | Local-only demo application shell (UI only; Demo Track audio in Phase 1B) |
| `/app`        | Combined mode shell per build-spec primary routes (controller + display)  |
| `/offline`    | Offline fallback document                                                 |
| `/api/health` | Liveness JSON (foundation convenience; not a product feature)             |

## Out of scope (confirmed)

Supabase, music-provider OAuth, microphone capture, Three.js visualizers, production AI, Android TV, and phases 1B–1G.

## Manual checks

1. `pnpm install && pnpm build`
2. `pnpm --filter @prism/web start` then open `/`, `/demo`, `/app`, `/offline`
3. Confirm `app/manifest.ts` and production SW registration path (`/sw.js`)

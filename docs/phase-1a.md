# Phase 1A — Repository and PWA foundation

## Goals delivered

- pnpm workspaces + Turborepo skeleton
- `apps/web` Next.js App Router + Tailwind + strict TypeScript
- Shared `packages/config`, `packages/contracts` (minimal), `packages/ui` stub
- PWA manifest + Serwist service worker path + `/offline` fallback
- `.env.example` placeholders
- Root scripts: `format`, `lint`, `typecheck`, `test`, `build`

## Routes

| Route         | Purpose                   |
| ------------- | ------------------------- |
| `/`           | Brand entry               |
| `/app`        | Local-only combined shell |
| `/offline`    | Offline fallback document |
| `/api/health` | Liveness JSON             |

## Out of scope (confirmed)

Supabase, music-provider OAuth, microphone capture, Three.js visualizers, production AI, Android TV, and phases 1B–1G.

## Manual checks

1. `pnpm install && pnpm build`
2. `pnpm --filter @prism/web start` then open `/`, `/app`, `/offline`
3. Confirm `app/manifest.ts` and production SW registration path (`/sw.js`)

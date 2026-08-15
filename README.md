# Prism

Atmospheric multi-device music visualizer companion.

## Status

**Phase 1A** — repository and PWA foundation (in progress / landing).

Later phases add Demo Track audio, visualizers, sessions, Live Listen, mock Dreamscape, and Android TV.

## Requirements

- Node.js 22+
- [pnpm](https://pnpm.io) 10+

## Quick start

```bash
pnpm install
pnpm dev
```

Web app: [http://localhost:3000](http://localhost:3000)

Phase 1A routes: `/` (entry), `/demo` (local demo shell), `/app` (combined mode), `/offline`.

## Scripts

| Script              | Description                     |
| ------------------- | ------------------------------- |
| `pnpm dev`          | Start Next.js in development    |
| `pnpm build`        | Production build (all packages) |
| `pnpm lint`         | ESLint across the workspace     |
| `pnpm typecheck`    | TypeScript checks               |
| `pnpm test`         | Vitest unit/component tests     |
| `pnpm format`       | Prettier write                  |
| `pnpm format:check` | Prettier check                  |

## Monorepo layout

```text
apps/web              Next.js App Router PWA
packages/config       Shared TS / ESLint / Tailwind tooling
packages/contracts    Zod schemas and domain types
packages/ui           Shared UI stub primitives
docs/                 Architecture and phase notes
```

## Environment

Copy `.env.example` to `apps/web/.env.local` when you need local values. Phase 1A does not require Supabase or AI keys—placeholders are documented for later phases only. Never put secrets in `NEXT_PUBLIC_*`.

## Spec

Authoritative product and phase rules: [`CURSOR-BUILD-SPEC-AI-MUSIC-VISUALIZER.md`](./CURSOR-BUILD-SPEC-AI-MUSIC-VISUALIZER.md).

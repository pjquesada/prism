# Prism

Atmospheric multi-device music visualizer companion.

## Status

**Phase 1B** — Demo Track, audio-engine feature frames, and Spectrum visualizer.

## Requirements

- Node.js 22+
- [pnpm](https://pnpm.io) 10+

## Quick start

```bash
pnpm install
pnpm dev
```

Web app: [http://localhost:3000](http://localhost:3000)

Routes: `/` (entry), `/demo` (Demo Track + Spectrum), `/app` (combined mode), `/offline`.

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

Demo Track regeneration:

```bash
node scripts/generate-demo-track.mjs
```

## Monorepo layout

```text
apps/web                 Next.js App Router PWA
packages/audio-engine    Web Audio Demo Track + feature frames
packages/visual-engine   R3F host + visualizer plugin contract
packages/visualizers     Spectrum (and later visualizers)
packages/config          Shared TS / ESLint / Tailwind tooling
packages/contracts       Zod schemas and domain types
packages/ui              Shared UI stub primitives
docs/                    Architecture and phase notes
```

## Environment

Copy `.env.example` to `apps/web/.env.local` when you need local values. Demo Track + Spectrum do not require API keys. Never put secrets in `NEXT_PUBLIC_*`.

## Spec

Authoritative product and phase rules: [`CURSOR-BUILD-SPEC-AI-MUSIC-VISUALIZER.md`](./CURSOR-BUILD-SPEC-AI-MUSIC-VISUALIZER.md).

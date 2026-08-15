# Prism — Cursor Build Specification: AI Music Visualizer

This document is the authoritative product and engineering specification for Prism. Cursor agents and contributors must read it before planning or implementing any feature. Implementation proceeds one phase at a time; Cursor must stop after every phase, run validation, summarize results, and wait for explicit human approval before continuing.

---

## 1. Product definition

**Prism** is a companion music visualizer for phones, tablets, laptops, desktop browsers, and Smart TVs, beginning with Google TV / Android TV.

Music continues playing through Spotify, Apple Music, SoundCloud, Pandora, or another source on the user’s own devices or apps. Prism analyzes audio locally or via permitted metadata/session cues and renders synchronized visuals across one or more displays.

A device may act as a **controller**, a **visual display**, or **both**. Multiple displays may join one synchronized session. The app must remain useful without a connected music provider through **Demo Track**, **Live Listen**, **Manual Sync**, and **Ambient** modes.

### Brand and experience intent

Prism is atmospheric, reactive, and calm—not a noisy dashboard. Visuals are the product; UI chrome stays secondary to the canvas. Controllers emphasize clear mode switching and session pairing; displays maximize immersive rendering.

---

## 2. Non-negotiable constraints

1. **No copyrighted music handling.** Prism does not stream, download, proxy, record, or redistribute copyrighted music.
2. **No microphone capture persistence.** Live Listen analyzes audio in real time on-device. Microphone audio must never be recorded, saved, uploaded, or transmitted.
3. **Providers are adapters only.** Music and AI capabilities live behind interfaces. Never invent unsupported provider APIs or claim production integrations that are not implemented and approved.
4. **Secrets stay server-side.** Never expose service-role keys, AI API keys, or other secrets to clients.
5. **Strict TypeScript.** Use TypeScript strict mode. Avoid `any`. Validate network and realtime payloads with Zod.
6. **Resource hygiene.** Dispose audio nodes, media elements, WebGL contexts, subscriptions, timers, and event listeners.
7. **Phase gating.** Implement only the explicitly requested phase. Do not start the next phase without user approval.
8. **Guest-first, account-optional.** Core MVP flows work as a guest. Accounts are optional enhancements.
9. **Privacy by default.** Collect the minimum data required for sessions and accounts. Prefer local analysis.
10. **Adaptive quality.** Rendering must degrade gracefully under thermal, GPU, or network pressure rather than freeze or crash.

---

## 3. MVP scope and exclusions

### 3.1 In scope (initial MVP)

- Responsive web application and installable PWA
- Controller, Display, and Combined modes
- QR-code or six-character-code pairing
- Real-time controller-to-display communication
- Demo Track using royalty-free bundled audio
- Live Listen using local microphone analysis
- Manual Sync
- Ambient mode
- Spectrum visualizer
- Particle visualizer
- Album World visualizer
- Dreamscape AI-assisted visualizer using mock keyframes initially
- Preset customization and saving
- Adaptive rendering quality
- Guest sessions
- Optional accounts
- Multiple displays
- Session handoff
- Android TV proof of concept after the web MVP

### 3.2 Explicitly out of scope (initial MVP)

- Production Apple Music integration
- Production SoundCloud integration
- Production Pandora integration
- Production Spotify approval flow
- Full AI video generation
- Social feeds
- Creator marketplace
- Billing
- Lyrics
- Copyrighted audio ingestion
- Native desktop system-audio capture
- Samsung Tizen, LG webOS, Roku, or Apple TV applications

---

## 4. Architecture

### 4.1 High-level shape

Prism is a monorepo:

| Layer | Responsibility |
| --- | --- |
| `apps/web` | Next.js App Router PWA: controller, display, combined modes, auth UI, pairing |
| `apps/android-tv` | Later Kotlin shell with hardware-accelerated WebView hosting display mode |
| `packages/audio-engine` | Web Audio analysis, Demo Track playback, Live Listen analysis, feature frames |
| `packages/visual-engine` | Three.js / R3F render loop, quality tiers, shared scene utilities |
| `packages/visualizers` | Pluggable visualizers (Spectrum, Particles, Album World, Dreamscape) |
| `packages/sync-engine` | Session state, device roles, realtime protocol helpers, handoff |
| `packages/provider-adapters` | Music provider interfaces and stubs (no production integrations in MVP) |
| `packages/ai-adapters` | AI provider interfaces; mock Dreamscape keyframe provider for MVP |
| `packages/contracts` | Shared Zod schemas, domain types, protocol messages |
| `packages/db` | Typed Supabase client helpers and schema types |
| `packages/ui` | Shared accessible UI primitives |
| `packages/config` | Shared ESLint, TypeScript, Tailwind, and tooling config |
| `supabase/migrations` | PostgreSQL schema, RLS, realtime publication |
| `docs` | Human-facing architecture and runbooks |

### 4.2 Runtime topology

```
[Controller device] --(Supabase Realtime / session channel)--> [Display device(s)]
        |                                                          |
   audio-engine                                              visual-engine
   (Demo / Live Listen /                                       + visualizers
    Manual Sync / Ambient cues)                                (WebGL / R3F)
        |
   optional music-provider adapter (metadata only; no audio proxy)
        |
   optional AI adapter (Dreamscape keyframes; mock in MVP)
```

### 4.3 Technology stack

- pnpm workspaces
- Turborepo
- TypeScript strict mode
- Next.js App Router
- React
- Tailwind CSS
- Three.js
- React Three Fiber
- Web Audio API
- Zustand
- TanStack Query
- Supabase (PostgreSQL, authentication, row-level security, realtime sessions)
- Zod
- Vitest
- React Testing Library
- Playwright
- Later: Kotlin Android TV shell containing a hardware-accelerated WebView

### 4.4 State ownership

- **Client UI/ephemeral render state:** Zustand
- **Server/async entity state (presets, profiles):** TanStack Query + Supabase
- **Cross-device session truth:** Supabase realtime channel messages validated by Zod contracts
- **Audio feature frames:** produced by `audio-engine`, consumed by visualizers; not persisted as audio

---

## 5. Recommended repository structure

```text
/
├── apps/
│   ├── web/                      # Next.js App Router PWA
│   └── android-tv/               # Kotlin WebView shell (Phase 1G)
├── packages/
│   ├── audio-engine/
│   ├── visual-engine/
│   ├── visualizers/
│   ├── sync-engine/
│   ├── provider-adapters/
│   ├── ai-adapters/
│   ├── contracts/
│   ├── db/
│   ├── ui/
│   └── config/
├── supabase/
│   └── migrations/
├── docs/
├── .cursor/
│   └── rules/
│       └── prism-development.mdc
├── CURSOR-BUILD-SPEC-AI-MUSIC-VISUALIZER.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

Do not invent additional top-level apps without approval. Shared types and Zod schemas belong in `packages/contracts`.

---

## 6. Primary routes

All routes live under `apps/web` unless noted.

| Route | Purpose |
| --- | --- |
| `/` | Marketing / entry; start guest session or sign in |
| `/app` | Combined mode default (controller + display on one device) |
| `/controller` | Controller-only UI |
| `/display` | Display-only immersive canvas |
| `/pair` | Enter six-character code or show pairing UI |
| `/pair/[code]` | Deep link / QR target for joining a session |
| `/session/[sessionId]` | Active session hub (role-aware redirect/shell) |
| `/presets` | Browse, edit, save presets |
| `/presets/[presetId]` | Preset detail / editor |
| `/settings` | Quality, audio mode, account, permissions |
| `/auth/sign-in` | Optional account sign-in |
| `/auth/sign-up` | Optional account sign-up |
| `/auth/callback` | Auth callback |
| `/offline` | PWA offline fallback |
| `/tv` | Display-optimized TV layout (used by Android TV WebView) |

Route handlers / server actions (as needed):

| Endpoint area | Purpose |
| --- | --- |
| `/api/health` | Liveness |
| `/api/session` | Create/join/leave session (server-validated) |
| `/api/presets` | CRUD for authenticated or guest-local sync where allowed |

Exact API shape may evolve, but contracts must be Zod-validated and documented in `packages/contracts`.

---

## 7. Core user flows

### 7.1 Guest combined session

1. Open `/`.
2. Start as guest → land in Combined mode (`/app`).
3. Choose Demo Track.
4. Select Spectrum visualizer.
5. Visuals react to bundled royalty-free audio.

### 7.2 Pair a second display

1. On controller, create or open a session and reveal QR + six-character code.
2. On display device, open `/pair` or scan QR → `/pair/[code]`.
3. Display joins as `display` role.
4. Controller changes visualizer/preset; all displays update in near-real time.

### 7.3 Live Listen

1. User selects Live Listen.
2. Browser requests microphone permission.
3. On deny: show denied-permission state with recovery instructions; do not crash.
4. On grant: analyze locally; emit feature frames only; never upload audio.

### 7.4 Manual Sync

1. User taps sync / beat-align control while external music plays on another app.
2. Prism aligns visual tempo/phase heuristically from user taps + local analysis cues.
3. No copyrighted audio is ingested or stored.

### 7.5 Ambient mode

1. User enables Ambient when no strong audio source is present.
2. Visualizers run on generative ambient motion profiles with optional low-energy reactivity.

### 7.6 Preset save and restore

1. Customize visualizer params and quality preferences.
2. Save preset (local for guests; cloud-backed when signed in).
3. Apply preset across devices in the same session.

### 7.7 Session handoff

1. Controller initiates handoff to another joined device.
2. Target device assumes controller role; previous controller becomes display or leaves.
3. Session continuity preserved (visualizer, preset, audio mode metadata).

### 7.8 Optional account

1. Guest upgrades via sign-in/sign-up.
2. Presets and preferences can sync to the user account under RLS.

### 7.9 Android TV display (post–web MVP)

1. Android TV app loads `/tv` in a hardware-accelerated WebView.
2. User pairs via code shown on TV or phone-driven QR flow.
3. TV acts as display (and later optional limited controller if approved).

---

## 8. TypeScript domain models

Canonical types live in `packages/contracts` and must be mirrored by Zod schemas.

```ts
export type DeviceRole = "controller" | "display" | "combined";

export type AudioMode =
  | "demo_track"
  | "live_listen"
  | "manual_sync"
  | "ambient"
  | "provider_companion"; // reserved; no production providers in MVP

export type VisualizerId =
  | "spectrum"
  | "particles"
  | "album_world"
  | "dreamscape";

export type QualityTier = "low" | "medium" | "high" | "ultra";

export interface UserProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  code: string; // six-character join code
  hostDeviceId: string;
  audioMode: AudioMode;
  visualizerId: VisualizerId;
  presetId: string | null;
  qualityTier: QualityTier;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface SessionDevice {
  id: string;
  sessionId: string;
  deviceId: string;
  role: DeviceRole;
  label: string | null;
  lastSeenAt: string;
  isOnline: boolean;
}

export interface AudioFeatureFrame {
  timestampMs: number;
  rms: number;
  peak: number;
  bpmEstimate: number | null;
  beatPhase: number; // 0..1
  bands: number[]; // normalized spectrum buckets
  energy: number;
  onset: boolean;
}

export interface VisualizerProps {
  features: AudioFeatureFrame;
  preset: PresetConfig;
  quality: QualityTier;
  albumArtUrl?: string | null;
  dreamscapeKeyframes?: DreamscapeKeyframe[];
}

export interface PresetConfig {
  id: string;
  name: string;
  visualizerId: VisualizerId;
  ownerUserId: string | null; // null = guest/local
  params: Record<string, unknown>; // refined per visualizer via Zod
  createdAt: string;
  updatedAt: string;
}

export interface DreamscapeKeyframe {
  id: string;
  t: number; // 0..1 timeline
  prompt: string;
  seed: number;
  imageUrl: string; // mock asset or generated still later
  transition: "cut" | "crossfade" | "morph";
}

export interface MusicProviderMetadata {
  providerId: string;
  trackTitle?: string;
  artistName?: string;
  albumArtUrl?: string;
  isPlaying?: boolean;
  positionMs?: number;
}
```

All externally received objects must parse through Zod before use.

---

## 9. Supabase database schema

### 9.1 Tables (PostgreSQL)

```sql
-- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- sessions
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) = 6),
  host_device_id text not null,
  created_by uuid references auth.users (id) on delete set null,
  audio_mode text not null,
  visualizer_id text not null,
  preset_id uuid,
  quality_tier text not null default 'high',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

-- session_devices
create table public.session_devices (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  device_id text not null,
  role text not null check (role in ('controller', 'display', 'combined')),
  label text,
  last_seen_at timestamptz not null default now(),
  is_online boolean not null default true,
  unique (session_id, device_id)
);

-- presets
create table public.presets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  visualizer_id text not null,
  params jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sessions
  add constraint sessions_preset_id_fkey
  foreign key (preset_id) references public.presets (id) on delete set null;
```

### 9.2 Row-level security (intent)

- Guests operate via ephemeral session tokens / device claims validated by server routes; do not rely on open RLS.
- Authenticated users can read/write their own `profiles` and `presets`.
- Session participants may read session rows they have joined; only controller/host may update authoritative session fields.
- Never allow client access with the service role key.

### 9.3 Realtime

- Publish `sessions` and `session_devices` changes as needed.
- Prefer a dedicated realtime channel per `session_id` for high-frequency control messages (see protocol). Feature frames may be sent on the channel only as compact numeric payloads—never raw audio.

---

## 10. Realtime synchronization protocol

### 10.1 Channel

- Channel name: `session:{sessionId}`
- All payloads: JSON + Zod validation on send and receive

### 10.2 Message envelope

```ts
type SessionMessage =
  | { type: "session.snapshot"; payload: SessionSnapshot; sentAt: string }
  | { type: "session.patch"; payload: PartialSessionPatch; sentAt: string }
  | { type: "device.joined"; payload: SessionDevice; sentAt: string }
  | { type: "device.left"; payload: { deviceId: string }; sentAt: string }
  | { type: "device.role"; payload: { deviceId: string; role: DeviceRole }; sentAt: string }
  | { type: "audio.mode"; payload: { audioMode: AudioMode }; sentAt: string }
  | { type: "audio.features"; payload: AudioFeatureFrame; sentAt: string }
  | { type: "visualizer.select"; payload: { visualizerId: VisualizerId }; sentAt: string }
  | { type: "preset.apply"; payload: { presetId: string | null; params?: PresetConfig["params"] }; sentAt: string }
  | { type: "quality.set"; payload: { qualityTier: QualityTier }; sentAt: string }
  | { type: "handoff.request"; payload: { targetDeviceId: string }; sentAt: string }
  | { type: "handoff.accept"; payload: { controllerDeviceId: string }; sentAt: string }
  | { type: "ping"; payload: { deviceId: string }; sentAt: string }
  | { type: "error"; payload: { code: string; message: string }; sentAt: string };
```

### 10.3 Rules

1. Controller (or combined acting as controller) is the authority for mode, visualizer, preset, and handoff.
2. Displays are render followers; they may emit presence/ping only unless granted controller via handoff.
3. `audio.features` must be throttled (target ≤ 30 Hz, prefer 15–20 Hz on constrained links).
4. Ignore malformed messages; log safely without crashing the render loop.
5. On reconnect, request `session.snapshot` before applying patches.

---

## 11. Audio-engine requirements

Package: `packages/audio-engine`

### Responsibilities

- Decode/play Demo Track (royalty-free bundled asset)
- Live Listen: microphone → AnalyserNode feature extraction only
- Manual Sync: tap-tempo / phase offset helpers
- Ambient: low-energy synthetic feature profiles
- Emit `AudioFeatureFrame` streams to subscribers
- Expose deterministic test hooks for fixtures

### Requirements

1. Use Web Audio API; keep graph disposal explicit (`close()`, disconnect nodes).
2. Never persist or transmit PCM/microphone buffers.
3. Demo Track must work offline once cached by the PWA.
4. Feature extraction must be resilient when audio is paused, silent, or permission-denied.
5. Provide a null/silent frame generator for Ambient and error fallbacks.
6. No DRM circumvention; no tab/system audio capture in MVP.

---

## 12. Visualizer plugin contract

Package: `packages/visualizers` + orchestration in `packages/visual-engine`

```ts
export interface VisualizerPlugin {
  id: VisualizerId;
  label: string;
  description: string;
  defaultParams: Record<string, unknown>;
  paramsSchema: ZodSchema; // from contracts
  supportsAlbumArt: boolean;
  supportsDreamscapeKeyframes: boolean;
  mount(ctx: VisualizerMountContext): VisualizerInstance;
}

export interface VisualizerInstance {
  update(props: VisualizerProps): void;
  setQuality(tier: QualityTier): void;
  resize(width: number, height: number): void;
  dispose(): void;
}
```

Rules:

- Plugins must be lazy-loadable.
- `dispose()` must free geometries, materials, textures, and animation handles.
- Unknown params fail schema validation and fall back to defaults.
- Visualizers must tolerate missing album art and empty keyframe lists.

---

## 13. Visualizer requirements

### 13.1 Spectrum

- Frequency bars or radial spectrum driven by `bands` / energy
- Clear beat emphasis using `onset` and `beatPhase`
- Readable on phone and 10-foot TV UI
- First vertical slice visualizer (Phase 1B)

### 13.2 Particles

- Particle field reactive to RMS/energy/onsets
- Quality tiers adjust particle count and simulation steps
- Avoid GC thrash; pool particles where practical

### 13.3 Album World

- Scene anchored by album art texture when available
- Without art, use elegant procedural placeholder (not a broken-image state)
- Parallax / world motion tied to beat energy
- Must not require a music provider; Demo Track may supply optional artwork asset

### 13.4 Dreamscape

- AI-assisted visualizer consuming `DreamscapeKeyframe[]`
- MVP uses a **mock AI provider** returning local/static keyframes
- Crossfade/morph between keyframes aligned to beat phase where possible
- Must degrade to Ambient-like motion if keyframes fail to load
- No full AI video generation in MVP

---

## 14. AI-provider adapter interface

Package: `packages/ai-adapters`

```ts
export interface AiProviderAdapter {
  readonly id: string;
  readonly capabilities: {
    keyframes: boolean;
    video: boolean; // must be false for MVP adapters
  };
  generateKeyframes(input: {
    prompt: string;
    seed?: number;
    count: number;
  }): Promise<DreamscapeKeyframe[]>;
}
```

MVP ships `MockAiProvider` only. Do not call paid APIs unless explicitly approved in a later phase. Never put AI secrets in client bundles.

---

## 15. Music-provider adapter interface

Package: `packages/provider-adapters`

```ts
export interface MusicProviderAdapter {
  readonly id: string;
  readonly capabilities: {
    metadata: boolean;
    transportControl: boolean;
    albumArt: boolean;
    audioProxy: boolean; // MUST always be false
  };
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getMetadata(): Promise<MusicProviderMetadata | null>;
}
```

MVP:

- No production Spotify / Apple Music / SoundCloud / Pandora integrations
- Optional stub/no-op adapter for interface testing only
- `audioProxy` is permanently false; Prism never proxies copyrighted audio

---

## 16. Preset configuration

- Presets bind a `visualizerId` + validated `params`
- Guests: local storage / IndexedDB; optional promotion after sign-in
- Authenticated users: `presets` table under RLS
- Session `preset.apply` may include inline params for ephemeral tweaks
- Each visualizer defines defaults and Zod schema in contracts
- Saving must handle offline (queue or local-only) with clear UI state

---

## 17. UI direction

- Immersive, visual-first; minimize chrome on Display and TV routes
- Controller UI: large tap targets, high contrast, simple mode switching
- One job per view: pair, control, or display—avoid dashboard clutter in the first viewport
- Use expressive typography via project fonts (not default system stacks alone)
- Atmospheric backgrounds behind non-canvas chrome; canvas itself is the primary visual anchor
- Required UI states everywhere network/media/permissions matter: loading, empty, denied-permission, offline, error, fallback
- TV (`/tv`): 10-foot UI spacing, focus-friendly controls if any overlays are shown
- Respect `prefers-reduced-motion` with tempered animation profiles

---

## 18. Privacy and security requirements

1. No copyrighted audio ingestion, upload, or redistribution
2. No microphone audio recording, saving, or transmission
3. Feature frames contain numeric analysis only
4. Environment secrets never shipped to the client
5. Supabase RLS enabled on user data tables
6. Session join codes are short-lived / rotatable where practical; rate-limit join attempts
7. Auth callbacks use secure cookies / PKCE per Supabase best practices
8. Content Security Policy appropriate for WebGL/PWA without exposing eval-based shortcuts
9. Do not log tokens, raw auth headers, or personally sensitive profile fields unnecessarily
10. Guest device IDs should be opaque and rotatable

---

## 19. Accessibility requirements

1. Controller and settings flows meet WCAG 2.2 AA where applicable
2. Keyboard support for non-canvas controls
3. Visible focus states
4. Screen-reader labels for buttons, modes, and permission prompts
5. Do not rely on color alone for beat/energy status indicators
6. `prefers-reduced-motion` support
7. Caption/description text for Demo Track metadata
8. Display mode may prioritize visuals; provide an accessible controller path on another device

---

## 20. Performance budgets

| Surface | Budget |
| --- | --- |
| Initial JS (web, route-level) | Aim ≤ 200 KB gzipped critical path where practical |
| Time to interactive (mid-tier mobile) | ≤ 3.5s on broadband for Combined Demo path |
| Display frame rate | Target 60 FPS on desktop; 30 FPS minimum acceptable on mid mobile at Medium quality |
| Feature frame emit rate | ≤ 30 Hz |
| Realtime control latency | < 150 ms one-way under normal conditions |
| Memory | No unbounded growth over 30-minute Demo session; dispose on route change |
| PWA offline | Shell + Demo Track + Spectrum available offline after first visit |
| Adaptive quality | Auto-step down on sustained frame time overshoot |

Quality tiers must map to concrete caps (particle counts, FFT size display, post-processing).

---

## 21. Environment-variable placeholders

Document in `.env.example` during Phase 1A (do not commit secrets):

```bash
# apps/web
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server only
NEXT_PUBLIC_ENABLE_LIVE_LISTEN=true
NEXT_PUBLIC_DEFAULT_QUALITY=high

# optional later AI (server only; unused in MVP mock)
AI_PROVIDER_API_KEY=
AI_PROVIDER_BASE_URL=

# tooling
POSTGRES_URL=                       # local supabase / CI if needed
```

Never prefix secrets with `NEXT_PUBLIC_`.

---

## 22. Testing strategy

| Layer | Tooling | Focus |
| --- | --- | --- |
| Unit | Vitest | audio feature math, Zod contracts, sync reducers, preset schema |
| Component | Vitest + React Testing Library | controller controls, pairing form, permission states |
| Integration | Vitest | session patch application, adapter mocks |
| E2E | Playwright | guest Demo Track path, pairing happy path, offline shell |
| Manual | Checklist per phase | TV distance readability, mic deny path, multi-display sync |

Rules:

- Prefer deterministic fixtures over flaky timing tests
- Mock AI and music providers
- Do not require real provider developer accounts for CI
- Production build must pass before a phase is marked complete

---

## 23. Definition of done (every phase)

A phase is done only when all of the following are true:

1. Acceptance criteria for that phase are met
2. Formatting, lint, type-checking, unit/component tests, and production build succeed
3. Relevant Playwright coverage exists or is explicitly deferred with approval
4. Loading / empty / denied-permission / offline / error / fallback states exist for touched flows
5. No secrets committed; no `any` introduced without documented exception and approval
6. Summary reported: files changed, commands run, results, manual verification steps, limitations, recommended next phase
7. Human approval granted before starting the next phase

---

## 24. Decisions intentionally deferred

- Production Spotify / Apple Music / SoundCloud / Pandora OAuth and ToS review
- Full AI video generation pipeline and cost controls
- Billing, subscriptions, and marketplace
- Lyrics synchronization
- Native desktop system-audio capture
- Non–Android TV platforms (Tizen, webOS, Roku, Apple TV)
- Exact FFT band count and default color systems (finalize during visualizer phases)
- Whether feature frames are always controller-originated vs display-local analysis in Live Listen multi-device setups (decide in Phase 1E with a written ADR)
- Conflict resolution for simultaneous multi-controller attempts (MVP assumes single controller)
- Internationalization beyond basic English UI copy
- Final analytics vendor (if any); default is none in MVP

---

## 25. Implementation phases

Cursor must work on **only** the explicitly requested phase. After each phase: stop, run formatting, lint, type-checking, tests, and a production build, summarize results, and **wait for approval** before continuing.

### Phase 1A — Repository and PWA foundation

**Goals**

- Initialize pnpm workspaces + Turborepo monorepo skeleton
- Create `apps/web` Next.js App Router app with Tailwind, strict TS
- Shared `packages/config`, `packages/contracts` (minimal), `packages/ui` stub
- PWA manifest, service worker shell, offline route
- Env example placeholders
- CI-friendly scripts: `format`, `lint`, `typecheck`, `test`, `build`

**Acceptance criteria**

- [ ] Workspace installs and turbo pipelines run
- [ ] `/`, `/app`, `/offline` render
- [ ] PWA installability basics present (manifest + SW registration path)
- [ ] Strict TypeScript enabled; no bloated boilerplate app features beyond foundation
- [ ] Format, lint, typecheck, tests, production build pass
- [ ] Summary delivered; wait for approval

### Phase 1B — Demo audio and Spectrum visualizer

**Goals**

- `packages/audio-engine` Demo Track playback + feature frames
- `packages/visual-engine` bootstrap with R3F/Three
- Spectrum visualizer plugin
- Combined mode plays Demo Track with reactive Spectrum

**Acceptance criteria**

- [ ] Royalty-free Demo Track bundled and playable
- [ ] Spectrum reacts to audio features
- [ ] Audio graph disposed on unmount
- [ ] Works offline after cache (where SW allows)
- [ ] Format, lint, typecheck, tests, production build pass
- [ ] Summary delivered; wait for approval

### Phase 1C — Particles, Album World, presets, and adaptive quality

**Goals**

- Particles and Album World visualizers
- Preset schema + save/load (local guest)
- Quality tiers with adaptive downgrade heuristic

**Acceptance criteria**

- [ ] User can switch among Spectrum, Particles, Album World
- [ ] Album World handles missing art with placeholder
- [ ] Presets persist for guest locally
- [ ] Quality tier changes affect render cost measurably
- [ ] Format, lint, typecheck, tests, production build pass
- [ ] Summary delivered; wait for approval

### Phase 1D — Sessions and device pairing

**Goals**

- Supabase schema migrations + RLS intent implemented for sessions/devices/presets/profiles
- QR + six-character pairing
- Realtime session channel with Zod-validated messages
- Controller / Display / Combined roles
- Multiple displays + session handoff

**Acceptance criteria**

- [ ] Create session, show code/QR, join from second browser profile
- [ ] Controller changes propagate to displays
- [ ] Handoff transfers controller role
- [ ] Guest sessions work without account; optional auth paths stubbed/integrated minimally
- [ ] Format, lint, typecheck, tests, production build pass
- [ ] Summary delivered; wait for approval

### Phase 1E — Live Listen

**Goals**

- Microphone permission flow
- Local analysis-only Live Listen mode
- Denied/error/fallback UI states

**Acceptance criteria**

- [ ] Live Listen visualizes ambient mic input locally
- [ ] No audio bytes transmitted or stored
- [ ] Permission denied path is recoverable and clear
- [ ] Format, lint, typecheck, tests, production build pass
- [ ] Summary delivered; wait for approval

### Phase 1F — Dreamscape using a mock AI provider

**Goals**

- `packages/ai-adapters` mock provider
- Dreamscape visualizer consuming mock keyframes
- Preset params for Dreamscape

**Acceptance criteria**

- [ ] Dreamscape runs with mock keyframes without external AI credentials
- [ ] Failure path falls back gracefully
- [ ] Adapter boundary respected (no leaked provider details into UI)
- [ ] Format, lint, typecheck, tests, production build pass
- [ ] Summary delivered; wait for approval

### Phase 1G — Android TV proof of concept

**Goals**

- `apps/android-tv` Kotlin shell with hardware-accelerated WebView
- Load `/tv` display experience
- Pairing with existing web session codes

**Acceptance criteria**

- [ ] TV app loads display UI in WebView with hardware acceleration enabled
- [ ] Device can join a session via documented pairing flow
- [ ] Proof of concept documented; not a store-ready release
- [ ] Format/lint/typecheck/tests/build for web packages still pass; Android build instructions documented
- [ ] Summary delivered; wait for approval

---

## 26. Agent operating protocol (mandatory)

When implementing:

1. Read this specification first.
2. Implement only the requested phase.
3. Inspect existing code before editing; preserve unrelated work.
4. Ask before major architecture changes.
5. On phase completion, run formatting, lint, type-checking, tests, and production build.
6. Report: files changed, commands run, results, manual verification steps, limitations, and recommended next phase.
7. Stop and wait for explicit approval before any further phase.

This file is documentation for planning and gated implementation. It does not itself initialize the application.

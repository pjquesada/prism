-- Phase 1D: guest sessions, pairing, playback, preset snapshots, RLS
-- Apply via Supabase CLI or SQL editor. Safe to re-run with IF NOT EXISTS patterns where noted.

create extension if not exists pgcrypto;

-- Optional account stub (no OAuth UI in Phase 1D)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.presets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  visualizer_id text not null,
  params jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  host_device_id text not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  display_mode text not null default 'mirror' check (display_mode in ('mirror', 'complementary')),
  seq bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz
);

create index if not exists guest_sessions_expires_at_idx on public.guest_sessions (expires_at);
create index if not exists guest_sessions_status_idx on public.guest_sessions (status);

create table if not exists public.session_devices (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.guest_sessions (id) on delete cascade,
  device_id text not null,
  role text not null check (role in ('controller', 'display', 'combined')),
  label text,
  display_mode text not null default 'mirror' check (display_mode in ('mirror', 'complementary')),
  last_seen_at timestamptz not null default now(),
  is_online boolean not null default true,
  unique (session_id, device_id)
);

create index if not exists session_devices_session_id_idx on public.session_devices (session_id);
create index if not exists session_devices_last_seen_at_idx on public.session_devices (last_seen_at);

create table if not exists public.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.guest_sessions (id) on delete cascade,
  code_hash text not null,
  code_hint text not null check (char_length(code_hint) = 2),
  attempts int not null default 0,
  max_attempts int not null default 8,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pairing_codes_session_id_idx on public.pairing_codes (session_id);
create index if not exists pairing_codes_expires_at_idx on public.pairing_codes (expires_at);
create unique index if not exists pairing_codes_active_hash_uidx
  on public.pairing_codes (code_hash)
  where consumed_at is null;

create table if not exists public.playback_state (
  session_id uuid primary key references public.guest_sessions (id) on delete cascade,
  audio_mode text not null default 'demo_track',
  is_playing boolean not null default false,
  position_ms double precision not null default 0,
  rate double precision not null default 1,
  track_id text not null default 'demo-track',
  seq bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.active_preset_snapshots (
  session_id uuid primary key references public.guest_sessions (id) on delete cascade,
  visualizer_id text not null,
  quality_tier text not null default 'high',
  preset_id text,
  params jsonb not null default '{}'::jsonb,
  seq bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Cleanup helpers
create or replace function public.expire_guest_sessions(now_ts timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  closed_count integer;
begin
  update public.guest_sessions
  set status = 'ended',
      closed_at = coalesce(closed_at, now_ts),
      updated_at = now_ts
  where status = 'active'
    and (expires_at < now_ts);
  get diagnostics closed_count = row_count;

  update public.pairing_codes
  set consumed_at = coalesce(consumed_at, now_ts)
  where consumed_at is null
    and expires_at < now_ts;

  update public.session_devices sd
  set is_online = false
  from public.guest_sessions gs
  where sd.session_id = gs.id
    and gs.status = 'ended'
    and sd.is_online = true;

  return closed_count;
end;
$$;

revoke all on function public.expire_guest_sessions(timestamptz) from public;
grant execute on function public.expire_guest_sessions(timestamptz) to service_role;

-- RLS: deny open client writes; server uses service role
alter table public.profiles enable row level security;
alter table public.presets enable row level security;
alter table public.guest_sessions enable row level security;
alter table public.session_devices enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.playback_state enable row level security;
alter table public.active_preset_snapshots enable row level security;

-- Authenticated profile/preset stubs (optional accounts later)
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists presets_select_own_or_public on public.presets;
create policy presets_select_own_or_public on public.presets
  for select to authenticated
  using (owner_user_id = auth.uid() or is_public = true);

drop policy if exists presets_write_own on public.presets;
create policy presets_write_own on public.presets
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Guest session tables: no anon policies (server-mediated). Service role bypasses RLS.
-- Optional read for authenticated participants can be added when account linking ships.

comment on table public.guest_sessions is 'Ephemeral guest visualizer sessions; mutations via service role only.';
comment on table public.pairing_codes is 'Hashed short-lived pairing codes; never expose hash to clients.';
comment on table public.playback_state is 'Authoritative playback anchors; no audio payloads.';
comment on table public.active_preset_snapshots is 'Ephemeral preset/visual intent snapshot for session followers.';

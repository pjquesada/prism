-- Phase 1D fix: durable guest credentials + pairing code plaintext for controller restore.
-- Service-role only (RLS enabled, no anon policies).

alter table public.pairing_codes
  add column if not exists code text;

comment on column public.pairing_codes.code is
  'Short-lived pairing code plaintext; service-role read only for controller snapshots.';

create table if not exists public.session_credentials (
  session_id uuid not null references public.guest_sessions (id) on delete cascade,
  device_id text not null,
  secret_hash text not null,
  role text not null check (role in ('controller', 'display', 'combined')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (session_id, device_id)
);

create index if not exists session_credentials_expires_at_idx
  on public.session_credentials (expires_at);

alter table public.session_credentials enable row level security;

comment on table public.session_credentials is
  'Hashed guest device secrets; mutations and reads via service role only.';

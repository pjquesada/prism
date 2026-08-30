-- Phase 1E: durable latest compact feature envelope per session (service-role only).
-- Safe to re-run with IF NOT EXISTS patterns.

create table if not exists public.session_feature_frames (
  session_id uuid primary key references public.guest_sessions (id) on delete cascade,
  frame_seq bigint not null check (frame_seq >= 0),
  timestamp_ms bigint not null check (timestamp_ms >= 0),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint session_feature_frames_payload_object_chk check (jsonb_typeof(payload) = 'object'),
  constraint session_feature_frames_payload_size_chk check (octet_length(payload::text) <= 768)
);

create index if not exists session_feature_frames_updated_at_idx
  on public.session_feature_frames (updated_at);

create table if not exists public.session_feature_receipts (
  session_id uuid primary key references public.guest_sessions (id) on delete cascade,
  device_id text not null,
  frame_seq bigint not null check (frame_seq >= 0),
  received_at_ms bigint not null check (received_at_ms >= 0),
  transport text not null check (transport in ('realtime', 'fallback')),
  updated_at timestamptz not null default now()
);

alter table public.session_feature_frames enable row level security;
alter table public.session_feature_receipts enable row level security;

comment on table public.session_feature_frames is
  'Latest compact audio.features envelope per session; numeric visualization levels only.';
comment on table public.session_feature_receipts is
  'Latest display ingestion acknowledgement per session; no audio payloads.';

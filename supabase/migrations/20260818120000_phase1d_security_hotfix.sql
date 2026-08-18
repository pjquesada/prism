-- Phase 1D security hotfix (forward-only).
--
-- Intentionally invalidates ALL active guest sessions, devices, pairing codes,
-- credentials, playback state, and preset snapshots. Do not derive HMAC values
-- from previously stored plaintext pairing codes or raw credentials — those
-- values are deleted instead.
--
-- Previous migrations (20260815000000, 20260816000000) are left untouched.
-- pairing_codes.code stored plaintext six-character codes; this migration
-- drops that column (and code_hint, which stored a plaintext prefix).
--
-- After this migration, pairing_codes.code_hash stores HMAC-SHA256 hex only
-- (computed in the app with server-only SESSION_SIGNING_SECRET). The schema
-- cannot persist plaintext pairing codes or raw guest credentials.
--
-- Safe to run once. Relies on the migration runner's single transaction
-- (Supabase CLI default). Do not wrap in nested BEGIN/COMMIT.

-- Foreign keys (from 20260815000000 / 20260816000000), all ON DELETE CASCADE
-- from guest_sessions:
--   session_devices.session_id        -> guest_sessions.id
--   pairing_codes.session_id          -> guest_sessions.id
--   playback_state.session_id         -> guest_sessions.id
--   active_preset_snapshots.session_id -> guest_sessions.id
--   session_credentials.session_id    -> guest_sessions.id
-- Delete children first, then sessions, so the wipe is explicit even without
-- relying on cascade.

delete from public.pairing_codes;
delete from public.session_credentials;
delete from public.playback_state;
delete from public.active_preset_snapshots;
delete from public.session_devices;
delete from public.guest_sessions;

-- Remove every column capable of storing a plaintext pairing code.
alter table public.pairing_codes
  drop column if exists code;

alter table public.pairing_codes
  drop column if exists code_hint;

-- HMAC digest column is preserved (code_hash). Revocation + hash format checks.
alter table public.pairing_codes
  add column if not exists revoked_at timestamptz;

alter table public.session_credentials
  add column if not exists revoked_at timestamptz;

alter table public.pairing_codes
  drop constraint if exists pairing_codes_code_hash_hmac_chk;

alter table public.pairing_codes
  add constraint pairing_codes_code_hash_hmac_chk
  check (code_hash ~ '^[a-f0-9]{64}$');

alter table public.session_credentials
  drop constraint if exists session_credentials_secret_hash_chk;

alter table public.session_credentials
  add constraint session_credentials_secret_hash_chk
  check (secret_hash ~ '^[a-f0-9]{64}$');

drop index if exists pairing_codes_active_hash_uidx;

create unique index if not exists pairing_codes_active_hmac_uidx
  on public.pairing_codes (code_hash)
  where consumed_at is null and revoked_at is null;

create unique index if not exists session_credentials_secret_hash_uidx
  on public.session_credentials (secret_hash);

create index if not exists pairing_codes_revoked_at_idx
  on public.pairing_codes (revoked_at);

create index if not exists session_credentials_revoked_at_idx
  on public.session_credentials (revoked_at);

comment on table public.guest_sessions is
  'Ephemeral guest visualizer sessions; mutations via service role only. All rows were invalidated by 20260818120000_phase1d_security_hotfix.';

comment on table public.pairing_codes is
  'HMAC-SHA256 (SESSION_SIGNING_SECRET) digests of normalized pairing codes. Plaintext codes are never stored. Active guest pairing state was intentionally wiped by 20260818120000_phase1d_security_hotfix.';

comment on column public.pairing_codes.code_hash is
  'HMAC-SHA256 hex digest of the normalized pairing code using server-only SESSION_SIGNING_SECRET. Never a plaintext code or unsalted SHA-256.';

comment on table public.session_credentials is
  'HMAC-SHA256 digests of guest device credentials; service-role only. Raw credentials are never stored. Existing credentials were invalidated by 20260818120000_phase1d_security_hotfix.';

comment on column public.session_credentials.secret_hash is
  'HMAC-SHA256 hex digest of the opaque guest credential using SESSION_SIGNING_SECRET. Never the raw credential.';

comment on column public.pairing_codes.revoked_at is
  'Set when a pairing code is rotated or explicitly revoked.';

comment on column public.session_credentials.revoked_at is
  'Set when a device credential is revoked (session end / rotation of device secret).';

comment on table public.playback_state is
  'Authoritative playback anchors; no audio payloads. Wiped by 20260818120000_phase1d_security_hotfix.';

comment on table public.active_preset_snapshots is
  'Ephemeral preset/visual intent snapshot for session followers. Wiped by 20260818120000_phase1d_security_hotfix.';

-- Fail closed if a plaintext pairing-code or raw-credential column remains.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pairing_codes'
      and column_name in ('code', 'plaintext_code', 'pairing_code', 'code_hint')
  ) then
    raise exception 'plaintext pairing code column still present on public.pairing_codes';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'session_credentials'
      and column_name in ('secret', 'token', 'credential', 'raw_secret', 'plaintext')
  ) then
    raise exception 'raw guest credential column still present on public.session_credentials';
  end if;

  if exists (select 1 from public.guest_sessions where status = 'active') then
    raise exception 'active guest sessions remain after security wipe';
  end if;
end
$$;

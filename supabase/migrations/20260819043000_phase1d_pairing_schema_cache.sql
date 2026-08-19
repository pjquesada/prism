-- Phase 1D: align pairing_codes with the HMAC hotfix and reload PostgREST.
-- Forward-only and idempotent. Does not wipe guest data.
--
-- Production symptom: POST /rest/v1/pairing_codes returns HTTP 400.
-- Confirmed incompatibility: the durable store inserted `revoked_at` (and
-- previously omitted leftover `code_hint`) while PostgREST still served the
-- pre-hotfix cache. Typical codes:
--   PGRST204  Could not find the 'revoked_at' column of 'pairing_codes'
--             in the schema cache
--   23502     null value in column "code_hint" violates not-null constraint
-- Applying 20260818120000 without `NOTIFY pgrst, 'reload schema'` leaves the
-- cache stale even after the Postgres columns are correct.

alter table public.pairing_codes
  drop column if exists code;

alter table public.pairing_codes
  drop column if exists code_hint;

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

notify pgrst, 'reload schema';

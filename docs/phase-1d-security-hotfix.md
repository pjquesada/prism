# Phase 1D security hotfix

This is a **forward-only** correction on top of the Phase 1D sessions work (PRs #5 and #6). Previously applied migrations are not modified.

## Why

PR #6 stored plaintext pairing codes in `public.pairing_codes.code` so controllers could restore the code after a refresh. Six-character codes hashed with unsalted SHA-256 are brute-forceable. Guest credentials used 192-bit secrets with unsalted SHA-256 digests, a single shared cookie, and `localStorage` / `sessionStorage` copies of the raw token. Production also fell back to an in-memory session map when Supabase was missing, which breaks pairing across isolates.

## What the new migration does

`supabase/migrations/20260818120000_phase1d_security_hotfix.sql`:

1. Deletes all ephemeral guest rows (pairing codes, credentials, playback, preset snapshots, devices, sessions) in foreign-key-safe order.
2. Drops `pairing_codes.code` and `pairing_codes.code_hint`.
3. Adds `revoked_at` on pairing codes and credentials.
4. Constrains digest columns to 64-char hex HMAC values and unique active HMAC indexes.
5. Leaves **no** active guest sessions.
6. Does **not** rehash old plaintext values.

After apply, every guest must create or join a new session.

## Pairing codes

- Normalized with `normalizePairingCodeInput` then validated.
- Stored only as `HMAC-SHA256(normalizedCode, SESSION_SIGNING_SECRET)` in `pairing_codes.code_hash`.
- Plaintext is returned only from `POST /api/session` (create) and `POST /api/session/:id/pairing` (rotate).
- Snapshots, restore responses, logs, and URLs never include the code (join QR still uses `/join?code=` by design).
- Controller restore uses the guest cookie, not the pairing code.
- Rotation requires controller authorization, revokes the previous code, stores only the new HMAC, and returns plaintext once.

## Guest credentials

- 32-byte (256-bit) opaque secrets.
- Only `HMAC-SHA256(secret, SESSION_SIGNING_SECRET)` is stored (`session_credentials.secret_hash`).
- Authoritative browser credential: `prism_guest_<sessionId>` HttpOnly cookie, `Path=/api/session`, `SameSite=Lax`, `Secure` in production, `Max-Age` aligned with expiry.
- `sessionStorage` may hold session id / role / route metadata only. Raw tokens are not written to Web Storage.

## Production configuration

Required server env (never `NEXT_PUBLIC_*`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SIGNING_SECRET` (≥ 32 bytes)

Missing secrets **fail closed**. Memory mode is only for local/dev/tests via `PRISM_SESSION_BACKEND=memory` and/or `PRISM_ALLOW_MEMORY_SESSIONS=true`. Database errors do not fall back to memory.

## Rollout

1. Merge this PR (do not apply the migration from a developer laptop against production unless that is the approved deploy path).
2. Set `SESSION_SIGNING_SECRET` in the hosting provider (Vercel / equivalent).
3. Apply `20260818120000_phase1d_security_hotfix.sql` to Supabase.
4. Deploy the web app that expects HMAC columns and session-scoped cookies.
5. Confirm `/start` creates a session and a second browser can `/join`.

## Rollback

Rolling back the **app** without rolling back the migration leaves a schema without plaintext `code`, which the old app expected. Rolling back the **migration** is not provided (forward-only). If you must revert the app, redeploy the previous web build only after restoring a pre-hotfix database backup — active guest sessions from after the hotfix would still be invalid.

Preferred recovery: keep the hotfix, rotate `SESSION_SIGNING_SECRET` only if it leaked (this invalidates all HMAC lookups; guests must re-pair).

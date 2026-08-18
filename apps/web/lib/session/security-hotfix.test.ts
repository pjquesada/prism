import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { digestPairingCode, hmacSha256Hex, timingSafeDigestEqual } from "./crypto";
import { getSessionSigningSecret } from "./config";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = join(WEB_ROOT, "../..");

function walkSource(root: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".next" ||
      entry.name === ".git"
    ) {
      continue;
    }
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      walkSource(full, acc);
    } else if (/\.(ts|tsx|js|mjs|sql|md|example)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("pairing-code HMAC", () => {
  it("normalizes to HMAC-SHA256 and is not unsalted SHA-256", () => {
    const secret = getSessionSigningSecret();
    const hmac = digestPairingCode("AB3K7M", secret);
    expect(hmac).toBe(hmacSha256Hex("AB3K7M", secret));
    expect(hmac).not.toBe(createHash("sha256").update("AB3K7M").digest("hex"));
    expect(timingSafeDigestEqual(hmac, hmac)).toBe(true);
    expect(timingSafeDigestEqual(hmac, "b".repeat(64))).toBe(false);
  });
});

describe("security hotfix migration and source scan", () => {
  it("adds a forward-only migration that drops plaintext pairing columns and wipes guest data", () => {
    const migrationsDir = join(REPO_ROOT, "supabase/migrations");
    const files = readdirSync(migrationsDir).sort();
    expect(files).toContain("20260815000000_phase1d_sessions.sql");
    expect(files).toContain("20260816000000_phase1d_session_credentials.sql");
    expect(files).toContain("20260818120000_phase1d_security_hotfix.sql");

    const original = readFileSync(
      join(migrationsDir, "20260815000000_phase1d_sessions.sql"),
      "utf8",
    );
    const credentials = readFileSync(
      join(migrationsDir, "20260816000000_phase1d_session_credentials.sql"),
      "utf8",
    );
    expect(original).toContain("create table if not exists public.pairing_codes");
    expect(credentials).toContain("add column if not exists code");

    const hotfix = readFileSync(
      join(migrationsDir, "20260818120000_phase1d_security_hotfix.sql"),
      "utf8",
    );
    expect(hotfix).toMatch(/delete from public\.pairing_codes/i);
    expect(hotfix).toMatch(/delete from public\.session_credentials/i);
    expect(hotfix).toMatch(/delete from public\.playback_state/i);
    expect(hotfix).toMatch(/delete from public\.active_preset_snapshots/i);
    expect(hotfix).toMatch(/delete from public\.session_devices/i);
    expect(hotfix).toMatch(/delete from public\.guest_sessions/i);
    expect(hotfix).toMatch(/drop column if exists code/i);
    expect(hotfix).toMatch(/drop column if exists code_hint/i);
    expect(hotfix).toMatch(/revoked_at/);
    expect(hotfix).toMatch(/intentionally invalidated/i);
    expect(hotfix).not.toMatch(/digest\(/i);
    expect(hotfix).not.toMatch(/encode\(digest/i);
  });

  it("does not keep plaintext pairing or credential columns in generated Database types", () => {
    const types = readFileSync(join(REPO_ROOT, "packages/db/src/types.ts"), "utf8");
    expect(types).not.toMatch(/code_hint/);
    expect(types).toMatch(/pairing_codes: TableDef</);
    expect(types).not.toMatch(/code: string \| null/);
    expect(types).toMatch(/secret_hash: string/);
    expect(types).not.toMatch(/secret: string/);
  });

  it("does not put credentials in query strings or unsalted SHA-256 pairing hashes in app code", () => {
    const files = walkSource(join(REPO_ROOT, "apps/web")).concat(
      walkSource(join(REPO_ROOT, "packages")),
    );
    const offenders: string[] = [];
    for (const file of files) {
      if (file.includes(".test.") || file.includes("fake-admin-client")) continue;
      const source = readFileSync(file, "utf8");
      if (
        source.includes('searchParams.get("token")') ||
        source.includes("searchParams.get('token')")
      ) {
        offenders.push(`${file}: token query parameter`);
      }
      if (source.includes('createHash("sha256").update(') && source.includes("pairing")) {
        offenders.push(`${file}: unsalted sha256 pairing hash`);
      }
      if (source.includes("localStorage.setItem") && /credential|token/.test(source)) {
        offenders.push(`${file}: credential localStorage`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

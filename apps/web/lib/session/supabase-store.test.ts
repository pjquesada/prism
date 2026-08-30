import { afterEach, describe, expect, it } from "vitest";

import { digestPairingCode } from "./crypto";
import { getSessionSigningSecret } from "./config";
import { createGuestSession, getSnapshotForCredential, joinWithPairingCode } from "./memory-store";
import {
  authorizeCredentialDurable,
  buildPairingCodeInsert,
  createGuestSessionDurable,
  getSnapshotForCredentialDurable,
  joinWithPairingCodeDurable,
  publishAuthorizedMessageDurable,
  publishSessionFeaturesDurable,
  rotatePairingCodeDurable,
} from "./supabase-store";
import {
  createFailingAdminClient,
  createFakeAdminClient,
  createFakeSessionDatabase,
  createPreHotfixPairingSchemaClient,
  createRevokedAtUnknownColumnClient,
  createStalePairingSchemaClient,
} from "./fake-admin-client";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_BACKEND = process.env.PRISM_SESSION_BACKEND;

describe("durable supabase session store", () => {
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.PRISM_SESSION_BACKEND = ORIGINAL_BACKEND;
  });

  it("creates a guest session on a production-configured durable store with HMAC-only pairing rows", async () => {
    process.env.NODE_ENV = "production";
    process.env.PRISM_SESSION_BACKEND = "supabase";
    const db = createFakeSessionDatabase();
    const client = createFakeAdminClient(db);
    const created = await createGuestSessionDurable(client, { role: "controller" });
    expect(created.pairingCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(db.pairing_codes).toHaveLength(1);
    expect(db.pairing_codes[0]).not.toHaveProperty("code");
    expect(db.pairing_codes[0]).not.toHaveProperty("code_hint");
    expect(JSON.stringify(db.pairing_codes)).not.toContain(created.pairingCode);
    expect(db.pairing_codes[0]?.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(db.pairing_codes[0]?.code_hash).toBe(
      digestPairingCode(created.pairingCode, getSessionSigningSecret()),
    );
    expect(db.pairing_codes[0]).not.toHaveProperty("revoked_at");
    expect(db.session_credentials[0]).not.toHaveProperty("secret");
    expect(db.session_credentials[0]).not.toHaveProperty("token");
    expect(JSON.stringify(db.session_credentials)).not.toContain(
      created.credential.token.split(".").slice(2).join("."),
    );
    await expect(
      client.from("pairing_codes").insert({
        session_id: created.snapshot.session.id,
        code: created.pairingCode,
        code_hash: "a".repeat(64),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).resolves.toMatchObject({ error: { message: expect.stringContaining("plaintext pairing") } });
  });

  it("rejects the previous pairing code after rotation", async () => {
    const db = createFakeSessionDatabase();
    const client = createFakeAdminClient(db);
    const created = await createGuestSessionDurable(client, { role: "controller" });
    const rotated = await rotatePairingCodeDurable(client, created.credential.token);
    await expect(
      joinWithPairingCodeDurable(client, {
        code: created.pairingCode,
        role: "display",
      }),
    ).rejects.toThrow(/Invalid or expired/);
    const joined = await joinWithPairingCodeDurable(client, {
      code: rotated.pairingCode,
      role: "display",
    });
    expect(joined.snapshot.session.id).toBe(created.snapshot.session.id);
  });

  it("restores the controller with its credential cookie material, not the pairing code", async () => {
    const db = createFakeSessionDatabase();
    const client = createFakeAdminClient(db);
    const created = await createGuestSessionDurable(client, { role: "controller" });
    const snapshot = await getSnapshotForCredentialDurable(client, created.credential.token);
    expect(snapshot).not.toHaveProperty("pairingCode");
    await expect(authorizeCredentialDurable(client, created.pairingCode)).rejects.toThrow(
      /Unauthorized/,
    );
  });

  it("joins and restores across separate client instances sharing one database", async () => {
    const db = createFakeSessionDatabase();
    const isolateA = createFakeAdminClient(db);
    const isolateB = createFakeAdminClient(db);
    const created = await createGuestSessionDurable(isolateA, { role: "controller" });
    const joined = await joinWithPairingCodeDurable(isolateB, {
      code: created.pairingCode,
      role: "display",
    });
    const restored = await getSnapshotForCredentialDurable(isolateB, joined.credential.token);
    expect(restored.session.id).toBe(created.snapshot.session.id);
    expect(restored.preset.visualizerId).toBe("spectrum");
  });

  it("gives a joining display the canonical snapshot without a live controller", async () => {
    const db = createFakeSessionDatabase();
    const controllerIsolate = createFakeAdminClient(db);
    const displayIsolate = createFakeAdminClient(db);
    const created = await createGuestSessionDurable(controllerIsolate, { role: "controller" });
    await publishAuthorizedMessageDurable(controllerIsolate, created.credential.token, {
      type: "visual.intent",
      seq: 0,
      sentAt: new Date().toISOString(),
      sessionId: created.snapshot.session.id,
      deviceId: created.credential.deviceId,
      payload: { visualizerId: "album_world" },
    });
    const joined = await joinWithPairingCodeDurable(displayIsolate, {
      code: created.pairingCode,
      role: "display",
    });
    expect(joined.snapshot.preset.visualizerId).toBe("album_world");
    const restored = await getSnapshotForCredentialDurable(displayIsolate, joined.credential.token);
    expect(restored.preset.visualizerId).toBe("album_world");
  });

  it("rejects visualizer mutations from a display credential", async () => {
    const db = createFakeSessionDatabase();
    const client = createFakeAdminClient(db);
    const created = await createGuestSessionDurable(client, { role: "controller" });
    const joined = await joinWithPairingCodeDurable(client, {
      code: created.pairingCode,
      role: "display",
    });
    await expect(
      publishAuthorizedMessageDurable(client, joined.credential.token, {
        type: "visual.intent",
        seq: 0,
        sentAt: new Date().toISOString(),
        sessionId: created.snapshot.session.id,
        deviceId: joined.credential.deviceId,
        payload: { visualizerId: "particles" },
      }),
    ).rejects.toThrow(/Displays cannot publish/);
    const snapshot = await getSnapshotForCredentialDurable(client, created.credential.token);
    expect(snapshot.preset.visualizerId).toBe("spectrum");
  });

  it("does not fall back to the memory store when the database errors", async () => {
    const memory = createGuestSession({ role: "controller" });
    await expect(
      createGuestSessionDurable(createFailingAdminClient(), { role: "controller" }),
    ).rejects.toMatchObject({ code: "database_unavailable" });
    expect(() => joinWithPairingCode({ code: memory.pairingCode, role: "display" })).not.toThrow();
    expect(() => getSnapshotForCredential("not-a-token")).toThrow(/Unauthorized/);
  });

  it("returns schema_mismatch for a stale PostgREST pairing_codes cache", async () => {
    await expect(
      createGuestSessionDurable(createStalePairingSchemaClient(), { role: "controller" }),
    ).rejects.toMatchObject({ code: "schema_mismatch" });
  });

  it("creates a session when PostgREST lacks revoked_at but the insert omits it", async () => {
    const { db, ...client } = createRevokedAtUnknownColumnClient();
    const created = await createGuestSessionDurable(client, { role: "combined" });
    expect(db.pairing_codes[0]).not.toHaveProperty("revoked_at");
    expect(db.pairing_codes[0]?.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.snapshot.session.id).toHaveLength(36);
  });

  it("returns schema_mismatch when leftover code_hint is still NOT NULL", async () => {
    await expect(
      createGuestSessionDurable(createPreHotfixPairingSchemaClient(), { role: "controller" }),
    ).rejects.toMatchObject({ code: "schema_mismatch" });
  });

  it("stores compact feature envelopes durably and broadcasts", async () => {
    const db = createFakeSessionDatabase();
    const client = createFakeAdminClient(db);
    const created = await createGuestSessionDurable(client, { role: "controller" });
    const playbackRows = db.playback_state.length;
    const presetRows = db.active_preset_snapshots.length;
    const result = await publishSessionFeaturesDurable(client, created.credential.token, {
      frameSeq: 4,
      timestampMs: Date.now(),
      rms: 0.2,
      energy: 0.3,
      bass: 0.1,
      mid: 0.1,
      high: 0.1,
      levels: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      onset: false,
      beatStrength: 0,
      centroid: 0.2,
    });
    expect(result.accepted).toBe(true);
    expect(result.durableFallback).toBe("stored");
    expect(JSON.stringify(result)).not.toMatch(/"bands"|pcm|fft|microphone/);
    expect(db.playback_state).toHaveLength(playbackRows);
    expect(db.active_preset_snapshots).toHaveLength(presetRows);
    expect(db.session_feature_frames).toHaveLength(1);
    expect(client.__broadcasts.length).toBeGreaterThan(0);
  });

  it("keeps durable latest frame when realtime broadcast fails", async () => {
    const db = createFakeSessionDatabase();
    const client = {
      ...createFakeAdminClient(db),
      channel: () => ({
        httpSend: async () => ({ error: { message: "broadcast_failed" } }),
        send: async () => ({ error: { message: "broadcast_failed" } }),
      }),
    };
    const created = await createGuestSessionDurable(client, { role: "controller" });
    const result = await publishSessionFeaturesDurable(client, created.credential.token, {
      frameSeq: 11,
      timestampMs: Date.now(),
      rms: 0.2,
      energy: 0.3,
      bass: 0.1,
      mid: 0.1,
      high: 0.1,
      levels: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      onset: false,
      beatStrength: 0,
      centroid: 0.2,
    });
    expect(result.accepted).toBe(true);
    expect(result.realtimeBroadcast).toBe("failed");
    expect(db.session_feature_frames[0]?.frame_seq).toBe(11);
  });

  it("rejects stale Live Listen envelopes without writing tables", async () => {
    const db = createFakeSessionDatabase();
    const client = createFakeAdminClient(db);
    const created = await createGuestSessionDurable(client, { role: "controller" });
    await expect(
      publishSessionFeaturesDurable(client, created.credential.token, {
        frameSeq: 8,
        timestampMs: Date.now() - 5_000,
        rms: 0,
        energy: 0,
        bass: 0,
        mid: 0,
        high: 0,
        levels: [0, 0, 0, 0, 0, 0, 0, 0],
        onset: false,
        beatStrength: 0,
        centroid: 0,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(db.session_feature_frames).toHaveLength(0);
  });

  it("returns constraint_violation for an invalid pairing HMAC digest", async () => {
    const db = createFakeSessionDatabase();
    const inner = createFakeAdminClient(db);
    const client = {
      from(relation: string) {
        if (relation !== "pairing_codes") return inner.from(relation);
        return {
          insert: async () => ({
            data: null,
            error: {
              code: "23514",
              message: "new row violates check constraint pairing_codes_code_hash_hmac_chk",
            },
          }),
        };
      },
    };
    await expect(createGuestSessionDurable(client, { role: "controller" })).rejects.toMatchObject({
      code: "constraint_violation",
    });
  });

  it("builds a post-hotfix pairing_codes insert without plaintext or revoked_at", () => {
    const row = buildPairingCodeInsert({
      sessionId: "11111111-1111-4111-8111-111111111111",
      codeHmac: "a".repeat(64),
      expiresAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    expect(Object.keys(row).sort()).toEqual([
      "attempts",
      "code_hash",
      "consumed_at",
      "created_at",
      "expires_at",
      "max_attempts",
      "session_id",
    ]);
    expect(row).not.toHaveProperty("code");
    expect(row).not.toHaveProperty("code_hint");
    expect(row).not.toHaveProperty("revoked_at");
    expect(row.code_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

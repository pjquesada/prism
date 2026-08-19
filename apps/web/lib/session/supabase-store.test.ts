import { afterEach, describe, expect, it } from "vitest";

import { createGuestSession, getSnapshotForCredential, joinWithPairingCode } from "./memory-store";
import {
  authorizeCredentialDurable,
  createGuestSessionDurable,
  getSnapshotForCredentialDurable,
  joinWithPairingCodeDurable,
  publishAuthorizedMessageDurable,
  rotatePairingCodeDurable,
} from "./supabase-store";
import {
  createFailingAdminClient,
  createFakeAdminClient,
  createFakeSessionDatabase,
} from "./fake-admin-client";

describe("durable supabase session store", () => {
  afterEach(() => {
    process.env.PRISM_SESSION_BACKEND = undefined;
  });

  it("persists HMAC pairing digests and never plaintext codes or raw credentials", async () => {
    const db = createFakeSessionDatabase();
    const client = createFakeAdminClient(db);
    const created = await createGuestSessionDurable(client, { role: "controller" });
    expect(db.pairing_codes).toHaveLength(1);
    expect(db.pairing_codes[0]).not.toHaveProperty("code");
    expect(db.pairing_codes[0]).not.toHaveProperty("code_hint");
    expect(JSON.stringify(db.pairing_codes)).not.toContain(created.pairingCode);
    expect(db.pairing_codes[0]?.code_hash).toMatch(/^[a-f0-9]{64}$/);
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
    ).rejects.toMatchObject({ code: "backend_unavailable" });
    expect(() => joinWithPairingCode({ code: memory.pairingCode, role: "display" })).not.toThrow();
    expect(() => getSnapshotForCredential("not-a-token")).toThrow(/Unauthorized/);
  });
});

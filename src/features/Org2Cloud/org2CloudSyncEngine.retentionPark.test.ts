/**
 * Retention parking on the push loop.
 *
 * A session past the org's retention window fails its push with
 * ORG2_RETENTION_EXPIRED on every pass; retention only recedes further
 * within a signed-in run, so the engine must stop re-walking the doomed
 * upload chain instead of retrying it each pass.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";

import { ORG2_CLOUD_ENDPOINT_OVERRIDE_STORAGE_KEY } from "./config";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import {
  RETENTION_PARKED_MAX_ENTRIES,
  org2CloudRetentionParkedAtom,
  pruneRetentionParked,
  retentionParkKey,
} from "./org2CloudSyncAtoms";
import { Org2CloudSyncError } from "./org2CloudSyncClient";
import {
  AUTH,
  SESSION,
  cleanupEngineFixture,
  createEngineFixture,
} from "./org2CloudSyncEngine.testUtils";
import type { EngineFixture } from "./org2CloudSyncEngine.testUtils";
import {
  getSyncJournalSnapshot,
  resetSyncJournalForTests,
} from "./org2CloudSyncJournal";

const parkKey = retentionParkKey(
  org2CloudAuthIdentityKey(AUTH),
  "corg-1",
  SESSION.session_id
);

describe("Org2CloudSyncEngine retention parking", () => {
  let fixture: EngineFixture;
  let engine: EngineFixture["engine"];

  beforeEach(() => {
    resetSyncJournalForTests();
    fixture = createEngineFixture();
    ({ engine } = fixture);
  });

  afterEach(() => {
    cleanupEngineFixture(engine);
    resetSyncJournalForTests();
  });

  it("parks a retention-expired session instead of retrying every pass", async () => {
    fixture.client.upsertSessionMetadata.mockRejectedValue(
      new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400)
    );

    await engine.runSyncPass();
    expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(1);
    expect(
      getSyncJournalSnapshot().some(
        (event) =>
          event.kind === "session_retention_parked" &&
          event.code === "ORG2_RETENTION_EXPIRED"
      )
    ).toBe(true);

    await engine.runSyncPass();
    expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying pushes that fail with other codes", async () => {
    fixture.client.upsertSessionMetadata.mockRejectedValue(
      new Org2CloudSyncError("ORG2_VALIDATION", 400)
    );

    await engine.runSyncPass();
    await engine.runSyncPass();
    expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(2);
  });

  it("persists the park so a fresh engine on the next boot does not retry the same local state", async () => {
    fixture.client.upsertSessionMetadata.mockRejectedValue(
      new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400)
    );
    await engine.runSyncPass();
    expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(1);
    expect(fixture.store.get(org2CloudRetentionParkedAtom)).toEqual({
      [parkKey]: SESSION.updated_at,
    });

    const persisted = fixture.store.get(org2CloudRetentionParkedAtom);
    cleanupEngineFixture(engine);
    const rebooted = createEngineFixture();
    engine = rebooted.engine;
    rebooted.store.set(org2CloudRetentionParkedAtom, persisted);
    rebooted.client.upsertSessionMetadata.mockRejectedValue(
      new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400)
    );
    await engine.runSyncPass();
    expect(rebooted.client.upsertSessionMetadata).not.toHaveBeenCalled();

    rebooted.store.set(org2CloudRetentionParkedAtom, {});
    await engine.runSyncPass();
    expect(rebooted.client.upsertSessionMetadata).toHaveBeenCalledTimes(1);
  });

  it("releases a persisted park once the session has new local activity", async () => {
    fixture.store.set(org2CloudRetentionParkedAtom, {
      [parkKey]: SESSION.updated_at,
    });
    fixture.client.upsertSessionMetadata.mockRejectedValue(
      new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400)
    );

    await engine.runSyncPass();
    expect(fixture.client.upsertSessionMetadata).not.toHaveBeenCalled();

    fixture.store.set(sessionsAtom, [
      { ...SESSION, updated_at: "2026-07-02T00:00:00.000Z" },
    ]);
    await engine.runSyncPass();
    expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(1);
    expect(fixture.store.get(org2CloudRetentionParkedAtom)).toEqual({
      [parkKey]: "2026-07-02T00:00:00.000Z",
    });
  });
  it("retries new activity after this engine parks the rejected version", async () => {
    fixture.client.upsertSessionMetadata.mockRejectedValue(
      new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400)
    );
    await engine.runSyncPass();
    fixture.store.set(sessionsAtom, [
      { ...SESSION, updated_at: "2026-07-02T00:00:00.000Z" },
    ]);
    await engine.runSyncPass();
    await engine.runSyncPass();
    expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(2);
  });

  it("revalidates after sign-out and sign-in", async () => {
    fixture.client.upsertSessionMetadata.mockRejectedValue(
      new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400)
    );
    await engine.runSyncPass();
    fixture.store.set(org2CloudAuthAtom, null);
    engine.stop();
    expect(fixture.store.get(org2CloudRetentionParkedAtom)).toEqual({});
    fixture.store.set(org2CloudAuthAtom, AUTH);
    engine.start(fixture.store);
    await engine.runSyncPass();
    expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...AUTH, userId: "another-user" },
    { ...AUTH, supabaseUrl: "https://other.example" },
  ])(
    "ignores a persisted park from another identity: %j",
    async (otherAuth) => {
      fixture.store.set(org2CloudRetentionParkedAtom, {
        [retentionParkKey(
          org2CloudAuthIdentityKey(otherAuth),
          "corg-1",
          SESSION.session_id
        )]: SESSION.updated_at,
        [`corg-1|${SESSION.session_id}`]: SESSION.updated_at,
      });
      fixture.client.upsertSessionMetadata.mockRejectedValue(
        new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400)
      );
      await engine.runSyncPass();
      expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(1);
    }
  );

  it("does not park an old rejection after the account changes", async () => {
    fixture.client.upsertSessionMetadata.mockImplementation(async () => {
      fixture.store.set(org2CloudAuthAtom, { ...AUTH, userId: "another-user" });
      throw new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400);
    });
    await engine.runSyncPass();
    expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(1);
    expect(fixture.store.get(org2CloudAuthAtom)?.userId).toBe("another-user");
    expect(fixture.store.get(org2CloudRetentionParkedAtom)).toEqual({});
  });

  it("caps the durable cache at 512 entries", () => {
    const entries = Object.fromEntries(
      Array.from({ length: 600 }, (_, i) => [String(i), SESSION.updated_at])
    );
    const kept = pruneRetentionParked(entries);
    expect(Object.keys(kept)).toHaveLength(RETENTION_PARKED_MAX_ENTRIES);
    expect(kept["0"]).toBeUndefined();
    expect(kept["599"]).toBe(SESSION.updated_at);
  });
  it("keeps the park across token refresh for the same identity", async () => {
    fixture.client.upsertSessionMetadata.mockRejectedValue(
      new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400)
    );
    await engine.runSyncPass();
    fixture.store.set(org2CloudAuthAtom, {
      ...AUTH,
      accessToken: "refreshed-token",
    });
    await engine.runSyncPass();
    expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(1);
    expect(fixture.store.get(org2CloudRetentionParkedAtom)[parkKey]).toBe(
      SESSION.updated_at
    );
  });

  it("rejects a late park when the endpoint changes before auth cleanup", async () => {
    fixture.client.upsertSessionMetadata.mockImplementation(async () => {
      localStorage.setItem(
        ORG2_CLOUD_ENDPOINT_OVERRIDE_STORAGE_KEY,
        JSON.stringify({
          supabaseUrl: "https://other.example",
          webOrigin: "https://other.example",
          anonKey: "public-key",
        })
      );
      throw new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400);
    });
    try {
      await engine.runSyncPass();
      expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(1);
      expect(fixture.store.get(org2CloudRetentionParkedAtom)).toEqual({});
    } finally {
      localStorage.removeItem(ORG2_CLOUD_ENDPOINT_OVERRIDE_STORAGE_KEY);
    }
  });
  it("preserves durable parks when startup remount restarts the same identity", async () => {
    fixture.client.upsertSessionMetadata.mockRejectedValue(
      new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400)
    );
    await engine.runSyncPass();
    const persisted = fixture.store.get(org2CloudRetentionParkedAtom);
    for (let cycle = 0; cycle < 3; cycle++) {
      engine.stop();
      expect(fixture.store.get(org2CloudRetentionParkedAtom)).toEqual(
        persisted
      );
      engine.start(fixture.store);
      await engine.runSyncPass();
    }
    expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(1);
  });

  it("clears parks when the engine stops after an account switch", async () => {
    fixture.client.upsertSessionMetadata.mockRejectedValue(
      new Org2CloudSyncError("ORG2_RETENTION_EXPIRED", 400)
    );
    await engine.runSyncPass();
    fixture.store.set(org2CloudAuthAtom, { ...AUTH, userId: "second-account" });
    engine.stop();
    expect(fixture.store.get(org2CloudRetentionParkedAtom)).toEqual({});
    engine.start(fixture.store);
    await engine.runSyncPass();
    expect(fixture.client.upsertSessionMetadata).toHaveBeenCalledTimes(2);
  });
});

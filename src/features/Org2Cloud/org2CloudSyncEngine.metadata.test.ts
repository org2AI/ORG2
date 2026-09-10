import { describe, expect, it } from "vitest";

import { toFrontendSession } from "@src/api/tauri/session";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import type { Session } from "@src/store/session/sessionAtom/types";

import {
  buildCloudSessionMetadata,
  isCloudPushCandidate,
} from "./org2CloudSessionSync.metadata";
import {
  SCOPE_KEY,
  SESSION,
  cleanupEngineFixture,
  createEngineFixture,
} from "./org2CloudSyncEngine.testUtils";

describe("buildCloudSessionMetadata", () => {
  it("mirrors the toRemoteMetadata shape with the cloud user as owner", () => {
    const metadata = buildCloudSessionMetadata(
      SESSION,
      "corg-1",
      "user-1",
      "Me",
      SCOPE_KEY,
      { accessMode: "full_replay", visibility: "org" },
      "https://example.com/me.png"
    );
    expect(metadata.id).toBe("corg-1:user-1:session-1");
    expect(metadata.orgId).toBe("corg-1");
    expect(metadata.ownerMemberId).toBe("user-1");
    expect(metadata.ownerAvatarUrl).toBe("https://example.com/me.png");
    expect(metadata.repoScopeKey).toBe(SCOPE_KEY);
    expect(metadata.accessMode).toBe("full_replay");
    expect(metadata.replayLevel).toBe("replay");
    expect(metadata.visibility).toBe("org");
  });

  it("carries the ladder outcome onto the wire (metadata_only + restricted)", () => {
    const metadata = buildCloudSessionMetadata(
      SESSION,
      "corg-1",
      "user-1",
      "Me",
      SCOPE_KEY,
      { accessMode: "metadata_only", visibility: "restricted" }
    );
    expect(metadata.accessMode).toBe("metadata_only");
    expect(metadata.replayLevel).toBe("metadata");
    expect(metadata.visibility).toBe("restricted");
  });
});

describe("isCloudPushCandidate", () => {
  it("never publishes a hydrated managed mirror in the sync loop", async () => {
    const { store, client, engine } = createEngineFixture();
    try {
      const hydrated = toFrontendSession({
        sessionId: SESSION.session_id,
        name: SESSION.name ?? "Managed native mirror",
        status: "completed",
        createdAt: SESSION.created_at,
        updatedAt: SESSION.updated_at,
        category: "cli_agent",
        keySource: "own_key",
        totalTokens: 0,
        background: false,
        isActive: false,
        pinned: false,
        clientOrigin: "org2",
      });
      store.set(sessionsAtom, [{ ...SESSION, ...hydrated }]);
      await engine.runSyncPass();
      await engine.runSyncPass();
      expect(client.upsertSessionMetadata).not.toHaveBeenCalled();
      // Prove the loop is live, not merely disabled by the fixture.
      store.set(sessionsAtom, [SESSION]);
      await engine.runSyncPass();
      expect(client.upsertSessionMetadata).toHaveBeenCalledTimes(1);
    } finally {
      cleanupEngineFixture(engine);
    }
  });
  it("excludes managed native mirrors even after exact-ID hydration", () => {
    expect(isCloudPushCandidate({ ...SESSION, clientOrigin: "org2" })).toBe(
      false
    );
    expect(isCloudPushCandidate({ ...SESSION, clientOrigin: "cli" })).toBe(
      true
    );
  });
  it("excludes imported teammate copies; ordinary external history is shareable", () => {
    expect(isCloudPushCandidate(SESSION)).toBe(true);
    // Imported teammate copy (pulled from the cloud) — excluded (echo-loop).
    expect(
      isCloudPushCandidate({
        ...SESSION,
        importedFrom: { orgId: "x" } as never,
      })
    ).toBe(false);
    // The user's OWN external history (no importedFrom) is now shareable.
    // Annotated rather than passed inline: the predicate only reads
    // provenance fields, so an inline literal trips the excess-property check on
    // the narrowed parameter — `category` is the case under test, not noise.
    const externalHistory: Session = {
      ...SESSION,
      category: "external_history",
    };
    expect(isCloudPushCandidate(externalHistory)).toBe(true);
    // External history that is ALSO an imported copy stays excluded.
    const importedExternalHistory: Session = {
      ...externalHistory,
      importedFrom: { orgId: "x" } as never,
    };
    expect(isCloudPushCandidate(importedExternalHistory)).toBe(false);
  });
});

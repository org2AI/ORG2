import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getImportedHistorySourceBySessionId } from "@src/api/tauri/externalHistory";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { loadCliTranscriptRevision } from "@src/engines/SessionCore/sync/adapters/cli/cliHistory";
import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session";

import type { CloudPushAccess } from "./org2CloudAccessSettings";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import { Org2CloudSessionSync } from "./org2CloudSessionSync";
import type { Org2CloudSyncClientDeps } from "./org2CloudSessionSync.types";
import type { CollabSessionPushCursor } from "./org2CloudSyncAtoms";
import { org2CloudPushCursorsAtom } from "./org2CloudSyncAtoms";

const mocks = vi.hoisted(() => ({
  childRevision: vi.fn(),
  capabilities: vi.fn(),
  syncFiles: vi.fn(),
  canonicalSnapshot: vi.fn(),
  persistedRevision: vi.fn(),
  persistedEvents: vi.fn(),
}));

vi.mock("./org2CloudCapabilities", () => ({
  getCloudCapabilitiesConfirmed: mocks.capabilities,
}));
vi.mock("./syncSessionSharedFiles", () => ({
  syncSessionSharedFiles: mocks.syncFiles,
}));

vi.mock("@src/engines/SessionCore/sync/adapters/cli/cliHistory", () => ({
  loadCliTranscriptRevision: vi.fn(async () => undefined),
}));

vi.mock(
  "@src/engines/SessionCore/conversations/localConversationExecutionTail",
  () => ({
    loadLocalExecutionChildrenRevision: mocks.childRevision,
    loadLocalCanonicalConversationSnapshot: mocks.canonicalSnapshot,
  })
);

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    getPersistedEventRevision: mocks.persistedRevision,
    getPersistedEvents: mocks.persistedEvents,
  },
}));

const AUTH: Org2CloudAuthState = {
  kind: "org2_cloud",
  supabaseUrl: "https://cloud.example",
  supabaseAnonKey: "anon",
  userId: "user-1",
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: 4_000_000_000,
};

const SESSION: Session = {
  session_id: "cliagent-root",
  status: "completed",
  created_at: "2026-09-05T00:00:00.000Z",
  updated_at: "2026-09-05T00:00:00.000Z",
  name: "Native root",
  orgId: "cloud:org-1",
  category: "cli_agent",
};

const ACCESS: CloudPushAccess = {
  accessMode: COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
  visibility: "org",
};

function event(id: string, text: string): SessionEvent {
  return {
    id,
    chunk_id: id,
    sessionId: SESSION.session_id,
    createdAt: "2026-09-05T00:00:00.000Z",
    functionName: "assistant_message",
    uiCanonical: "assistant_message",
    actionType: "assistant",
    args: {},
    result: {},
    source: "assistant",
    displayText: text,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    payloadRefs: [],
  } as SessionEvent;
}

function client() {
  return {
    upsertSessionMetadata: vi.fn(async () => undefined),
    appendSessionEvents: vi.fn(async () => undefined),
    rewriteSessionEvents: vi.fn(async () => undefined),
    getSessionEvents: vi.fn(async () => ({ events: [], epoch: 0 })),
    getOrgRepoScopes: vi.fn(async () => ({ repoScopes: [] })),
    listOrgSessions: vi.fn(async () => ({ sessions: [] })),
    deleteSession: vi.fn(async () => undefined),
  } as unknown as Org2CloudSyncClientDeps & {
    appendSessionEvents: ReturnType<typeof vi.fn>;
    rewriteSessionEvents: ReturnType<typeof vi.fn>;
  };
}

describe("Org2CloudSessionSync local continuation replay", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capabilities.mockResolvedValue({ confirmed: true, capabilities: {} });
    mocks.syncFiles.mockResolvedValue(true);
    vi.mocked(loadCliTranscriptRevision).mockResolvedValue(undefined);
    mocks.childRevision.mockResolvedValue("[]");
    mocks.persistedRevision.mockResolvedValue(null);
    mocks.persistedEvents.mockResolvedValue([]);
  });

  async function pushPass(
    sync: Org2CloudSessionSync,
    session: Session = SESSION
  ): Promise<void> {
    sync.beginPass();
    try {
      await sync.pushSession(AUTH, "org-1", session, null, ACCESS);
    } finally {
      sync.endPass();
    }
  }

  it("publishes a native root with user/tool history despite an assistant-only cache, and skips unchanged reads", async () => {
    const store = createStore();
    const cloud = client();
    const sync = new Org2CloudSessionSync(() => store, cloud);
    const complete = [
      event("user", "question"),
      event("tool", "read result"),
      event("assistant", "answer"),
    ];
    mocks.persistedEvents.mockResolvedValue([complete[2]]);
    vi.mocked(loadCliTranscriptRevision).mockResolvedValue("native-1");
    mocks.canonicalSnapshot.mockResolvedValue({
      events: complete,
      childRevision: "[]",
    });
    await pushPass(sync);
    await pushPass(sync);
    expect(mocks.canonicalSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.persistedEvents).not.toHaveBeenCalled();
    expect(
      store.get(org2CloudPushCursorsAtom)[`org-1:${SESSION.session_id}`]
        ?.pushedCount
    ).toBe(3);

    vi.mocked(loadCliTranscriptRevision).mockResolvedValue("native-2");
    mocks.canonicalSnapshot.mockResolvedValue({
      events: [...complete, event("next", "reply")],
      childRevision: "[]",
    });
    await pushPass(sync);
    expect(mocks.canonicalSnapshot).toHaveBeenCalledTimes(2);
    expect(
      store.get(org2CloudPushCursorsAtom)[`org-1:${SESSION.session_id}`]
        ?.pushedCount
    ).toBe(4);
  });

  it("backfills files once for an otherwise clean pre-upload cursor", async () => {
    const store = createStore();
    const cloud = client();
    const sync = new Org2CloudSessionSync(() => store, cloud);
    const events = [event("generated", "[report](/sender/report.md)")];
    vi.mocked(loadCliTranscriptRevision).mockResolvedValue("native-1");
    mocks.canonicalSnapshot.mockResolvedValue({ events, childRevision: "[]" });
    await pushPass(sync);
    const key = `org-1:${SESSION.session_id}`;
    store.set(org2CloudPushCursorsAtom, (current) => ({
      ...current,
      [key]: { ...current[key], sharedFilesVersion: undefined },
    }));
    mocks.capabilities.mockResolvedValue({
      confirmed: true,
      capabilities: { sharedSessionFiles: true },
    });
    mocks.syncFiles.mockClear();
    await pushPass(sync);
    expect(mocks.canonicalSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.syncFiles).toHaveBeenCalledWith(
      expect.objectContaining({ events })
    );
    expect(store.get(org2CloudPushCursorsAtom)[key].sharedFilesVersion).toBe(1);
    await pushPass(sync);
    expect(mocks.canonicalSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.syncFiles).toHaveBeenCalledTimes(1);
  });

  it("refuses a native root that changes during replay materialization", async () => {
    const sync = new Org2CloudSessionSync(() => createStore(), client());
    vi.mocked(loadCliTranscriptRevision)
      .mockResolvedValueOnce("before")
      .mockResolvedValue("after");
    mocks.canonicalSnapshot.mockResolvedValue({
      events: [event("partial", "partial")],
      childRevision: "[]",
    });
    await expect(
      (
        sync as unknown as {
          loadPushEvents(id: string): Promise<SessionEvent[]>;
        }
      ).loadPushEvents(SESSION.session_id)
    ).rejects.toThrow("changed while preparing cloud replay");
    expect(mocks.persistedEvents).not.toHaveBeenCalled();
  });

  it("refuses unavailable native roots instead of certifying cached partial output", async () => {
    const sync = new Org2CloudSessionSync(() => createStore(), client());
    vi.mocked(loadCliTranscriptRevision).mockResolvedValue(null);
    mocks.canonicalSnapshot.mockResolvedValue({
      events: [event("partial", "partial")],
      childRevision: "[]",
    });
    await expect(
      (
        sync as unknown as {
          loadPushEvents(id: string): Promise<SessionEvent[]>;
        }
      ).loadPushEvents(SESSION.session_id)
    ).rejects.toThrow("changed while preparing cloud replay");
  });

  it("publishes the verified root-plus-child snapshot through the full replay owner", async () => {
    const store = createStore();
    const cloud = client();
    const sync = new Org2CloudSessionSync(() => store, cloud);
    const combined = [event("root", "root"), event("child", "child")];
    mocks.childRevision.mockResolvedValue(
      '[["cliagent-child","2026-09-05","2026-09-05"]]'
    );
    mocks.canonicalSnapshot.mockResolvedValue({
      events: combined,
      childRevision: '[["cliagent-child","2026-09-05","2026-09-05"]]',
    });

    await pushPass(sync);

    expect(mocks.canonicalSnapshot).toHaveBeenCalledWith({
      authority: "local-session",
      authorityScope: [],
      conversationId: SESSION.session_id,
    });
    expect(mocks.persistedEvents).not.toHaveBeenCalled();
    expect(
      store.get(org2CloudPushCursorsAtom)[`org-1:${SESSION.session_id}`]
        ?.pushedCount
    ).toBe(combined.length);
  });

  it("uses the imported source identity when publishing its continuation children", async () => {
    const store = createStore();
    const cloud = client();
    const sync = new Org2CloudSessionSync(() => store, cloud);
    const imported = {
      ...SESSION,
      session_id: "codexapp-native-root",
      category: "external_history" as const,
    };
    const combined = [event("imported", "imported"), event("child", "child")];
    mocks.childRevision.mockResolvedValue(
      '[["cliagent-child","2026-09-05","2026-09-05"]]'
    );
    mocks.canonicalSnapshot.mockResolvedValue({
      events: combined,
      childRevision: '[["cliagent-child","2026-09-05","2026-09-05"]]',
    });
    const source = getImportedHistorySourceBySessionId(imported.session_id);
    expect(source?.loadCloudTurnIds).toBeDefined();
    const incrementalReader = vi.spyOn(source!, "loadCloudTurnIds");
    // This checkpoint is intentionally incomplete: the child frontier must
    // choose the full canonical snapshot before inspecting imported replay.
    const cursor = {
      importedReplay: { version: 1 },
    } as CollabSessionPushCursor;

    const prepared = await (
      sync as unknown as {
        preparePushEventsForPass(
          sessionId: string,
          cursor: CollabSessionPushCursor
        ): Promise<{ mode: string; events: SessionEvent[] }>;
      }
    ).preparePushEventsForPass(imported.session_id, cursor);

    expect(mocks.canonicalSnapshot).toHaveBeenCalledWith({
      authority: "imported-history",
      authorityScope: ["codex_app"],
      conversationId: imported.session_id,
    });
    expect(mocks.persistedEvents).not.toHaveBeenCalled();
    expect(prepared).toMatchObject({ mode: "full", events: combined });
    expect(incrementalReader).not.toHaveBeenCalled();
  });

  it("publishes an SDE Agent root with its native continuation children", async () => {
    const store = createStore();
    const cloud = client();
    const sync = new Org2CloudSessionSync(() => store, cloud);
    const agent = {
      ...SESSION,
      session_id: "sdeagent-native-root",
      category: "rust_agent" as const,
      agentDefinitionId: "builtin:sde",
    };
    const combined = [event("agent", "agent"), event("child", "child")];
    mocks.childRevision.mockResolvedValue(
      '[["cliagent-child","2026-09-05","2026-09-05"]]'
    );
    mocks.canonicalSnapshot.mockResolvedValue({
      events: combined,
      childRevision: '[["cliagent-child","2026-09-05","2026-09-05"]]',
    });

    await pushPass(sync, agent);

    expect(mocks.canonicalSnapshot).toHaveBeenCalledWith({
      authority: "local-session",
      authorityScope: [],
      conversationId: agent.session_id,
    });
    expect(mocks.persistedEvents).not.toHaveBeenCalled();
  });

  it("keeps the existing EventStore reader when a local root has no children", async () => {
    const store = createStore();
    const cloud = client();
    const sync = new Org2CloudSessionSync(() => store, cloud);
    const agent = {
      ...SESSION,
      session_id: "sdeagent-without-child",
      category: "rust_agent" as const,
      agentDefinitionId: "builtin:sde",
    };
    const persisted = [event("agent", "agent")];
    mocks.persistedEvents.mockResolvedValue(persisted);

    await pushPass(sync, agent);

    expect(mocks.canonicalSnapshot).not.toHaveBeenCalled();
    expect(mocks.persistedEvents).toHaveBeenCalledWith(agent.session_id);
    expect(
      store.get(org2CloudPushCursorsAtom)[`org-1:${agent.session_id}`]
        ?.pushedCount
    ).toBe(persisted.length);
  });

  it("keeps the existing reader without probing execution children for a non-conversation session", async () => {
    const store = createStore();
    const cloud = client();
    const sync = new Org2CloudSessionSync(() => store, cloud);
    const persisted = [event("plain", "plain")];
    mocks.persistedEvents.mockResolvedValue(persisted);

    const events = await (
      sync as unknown as {
        loadPushEvents(sessionId: string): Promise<SessionEvent[]>;
      }
    ).loadPushEvents("plain-session");

    expect(events).toEqual(persisted);
    expect(mocks.childRevision).not.toHaveBeenCalled();
    expect(mocks.canonicalSnapshot).not.toHaveBeenCalled();
  });

  it("invalidates a clean root when only its child frontier changes", async () => {
    const store = createStore();
    const cloud = client();
    const sync = new Org2CloudSessionSync(() => store, cloud);
    let revision = "revision-1";
    let combined = [event("root", "root"), event("child-1", "one")];
    mocks.childRevision.mockImplementation(async () => revision);
    mocks.canonicalSnapshot.mockImplementation(async () => ({
      events: combined,
      childRevision: revision,
    }));

    await pushPass(sync);
    await pushPass(sync);
    expect(mocks.canonicalSnapshot).toHaveBeenCalledTimes(1);

    revision = "revision-2";
    combined = [...combined, event("child-2", "two")];
    await pushPass(sync);

    expect(mocks.canonicalSnapshot).toHaveBeenCalledTimes(2);
    expect(
      cloud.appendSessionEvents.mock.calls.length +
        cloud.rewriteSessionEvents.mock.calls.length
    ).toBeGreaterThan(1);
  });

  it.each([false, true])(
    "revalidates a persisted cursor across two cold engines without rewriting (native root: %s)",
    async (nativeRoot) => {
      const store = createStore();
      const cloud = client();
      const combined = [event("root", "root"), event("child", "child")];
      mocks.childRevision.mockResolvedValue("stable-1");
      mocks.canonicalSnapshot.mockResolvedValue({
        events: combined,
        childRevision: "stable-1",
      });
      if (nativeRoot) {
        vi.mocked(loadCliTranscriptRevision).mockResolvedValue(
          "root-native-stable"
        );
        mocks.childRevision.mockResolvedValue("[]");
        mocks.canonicalSnapshot.mockResolvedValue({
          events: combined,
          childRevision: "[]",
        });
      }
      await pushPass(new Org2CloudSessionSync(() => store, cloud));
      const cursorBefore = store.get(org2CloudPushCursorsAtom)[
        `org-1:${SESSION.session_id}`
      ];
      cloud.rewriteSessionEvents.mockClear();
      cloud.appendSessionEvents.mockClear();
      mocks.canonicalSnapshot.mockClear();

      for (let boot = 0; boot < 2; boot += 1) {
        const sync = new Org2CloudSessionSync(() => store, cloud);
        for (let pass = 0; pass < 3; pass += 1) await pushPass(sync);
      }
      // Each cold owner really reads the snapshot once; clean later passes are
      // bounded. Zero mutations are paired with this positive liveness proof.
      expect(mocks.canonicalSnapshot).toHaveBeenCalledTimes(2);
      expect(cloud.rewriteSessionEvents).not.toHaveBeenCalled();
      expect(cloud.appendSessionEvents).not.toHaveBeenCalled();
      expect(
        store.get(org2CloudPushCursorsAtom)[`org-1:${SESSION.session_id}`]
      ).toEqual(cursorBefore);
    }
  );

  it("refuses unstable child snapshots before any cloud mutation and recovers after stabilization", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const store = createStore();
    const cloud = client();
    const sync = new Org2CloudSessionSync(() => store, cloud);
    const combined = [event("root", "root"), event("child", "child")];
    mocks.childRevision.mockResolvedValue("stable-1");
    mocks.canonicalSnapshot.mockResolvedValue({
      events: combined,
      childRevision: "stable-1",
    });
    await pushPass(sync);
    const cursorBefore = store.get(org2CloudPushCursorsAtom)[
      `org-1:${SESSION.session_id}`
    ];
    cloud.rewriteSessionEvents.mockClear();
    cloud.appendSessionEvents.mockClear();

    // A provider transcript is replaced while it is read. Repeated partial
    // reads are still not authoritative truncation, even with a nonzero count.
    mocks.childRevision.mockResolvedValue(null);
    mocks.canonicalSnapshot.mockResolvedValue({
      events: combined.slice(0, 1),
      childRevision: null,
    });
    for (let pass = 0; pass < 3; pass += 1) {
      now += 600_000;
      await expect(pushPass(sync)).rejects.toThrow(
        "changed while preparing cloud replay"
      );
    }
    expect(cloud.rewriteSessionEvents).not.toHaveBeenCalled();
    expect(cloud.appendSessionEvents).not.toHaveBeenCalled();
    expect(
      store.get(org2CloudPushCursorsAtom)[`org-1:${SESSION.session_id}`]
    ).toEqual(cursorBefore);

    mocks.childRevision.mockResolvedValue("stable-2");
    now += 600_000;
    mocks.canonicalSnapshot.mockResolvedValue({
      events: [...combined, event("next", "next")],
      childRevision: "stable-2",
    });
    await pushPass(sync);
    expect(cloud.rewriteSessionEvents).not.toHaveBeenCalled();
    expect(cloud.appendSessionEvents).toHaveBeenCalledTimes(1);
    expect(
      store.get(org2CloudPushCursorsAtom)[`org-1:${SESSION.session_id}`]
        ?.pushedCount
    ).toBe(3);
  });
});

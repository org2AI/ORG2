import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session";

import type { CloudPushAccess } from "./org2CloudAccessSettings";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import { Org2CloudSessionSync } from "./org2CloudSessionSync";
import type { Org2CloudSyncClientDeps } from "./org2CloudSessionSync.types";
import { org2CloudPushCursorsAtom } from "./org2CloudSyncAtoms";

const mocks = vi.hoisted(() => ({
  childRevision: vi.fn(),
  canonicalSnapshot: vi.fn(),
  persistedRevision: vi.fn(),
  persistedEvents: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistedRevision.mockResolvedValue(null);
    mocks.persistedEvents.mockResolvedValue([]);
  });

  async function pushPass(sync: Org2CloudSessionSync): Promise<void> {
    sync.beginPass();
    try {
      await sync.pushSession(AUTH, "org-1", SESSION, null, ACCESS);
    } finally {
      sync.endPass();
    }
  }

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
});

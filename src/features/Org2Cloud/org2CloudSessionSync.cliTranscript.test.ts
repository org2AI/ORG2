import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rpc } from "@src/api/tauri/rpc";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";
import * as tauri from "@src/util/platform/tauri/init";

import { org2CloudAuthAtom } from "./org2CloudAuthAtom";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import { Org2CloudSessionSync } from "./org2CloudSessionSync";
import { buildCloudSessionMetadata } from "./org2CloudSessionSync.metadata";
import type { Org2CloudSyncClientDeps } from "./org2CloudSessionSync.types";
import { loadCliSessionTranscript } from "./org2CloudSessionTranscript";
import { org2CloudPushCursorsAtom } from "./org2CloudSyncAtoms";

vi.mock("@src/engines/SessionCore/ingestion/rustBridge", () => ({
  processChunksRust: vi.fn(),
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    subscribe: vi.fn(() => () => undefined),
    getPersistedEvents: vi.fn(),
    countPersistedEvents: vi.fn(),
    getPersistedEventRevision: vi.fn(),
  },
}));

const eventStoreMock = vi.mocked(eventStoreProxy);
const processChunksRustMock = vi.mocked(processChunksRust);
const SCOPE_KEY = "github.com/acme/alpha";
const AUTH: Org2CloudAuthState = {
  kind: "org2_cloud",
  supabaseUrl: "https://example.com",
  supabaseAnonKey: "anon",
  userId: "user-1",
  accessToken: "jwt",
  refreshToken: "rt",
  expiresAt: 9999999999,
  profile: { displayName: "Me" },
};
const session: Session = {
  session_id: "cliagent-transcript",
  status: "completed",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
  name: "CLI session",
  orgId: "cloud:corg-1",
  category: "rust_agent",
};
function makeEvent(id: string): SessionEvent {
  return {
    id,
    sessionId: session.session_id,
    displayStatus: "completed",
  } as SessionEvent;
}

const access = {
  accessMode: COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
  visibility: "org" as const,
};
const key = `corg-1:${session.session_id}`;

function fixture() {
  const store = createStore();
  store.set(org2CloudAuthAtom, AUTH);
  const client = {
    upsertSessionMetadata: vi.fn(async () => {}),
    rewriteSessionEvents: vi.fn<
      Org2CloudSyncClientDeps["rewriteSessionEvents"]
    >(async () => {}),
    appendSessionEvents: vi.fn(async () => {}),
    getSessionEvents: vi.fn(async () => ({ events: [], epoch: 0 })),
    getOrgRepoScopes: vi.fn(async () => ({ repoScopes: [] })),
    listOrgSessions: vi.fn(async () => ({ sessions: [] })),
    deleteSession: vi.fn(async () => {}),
  };
  const sync = new Org2CloudSessionSync(
    () => store,
    client as unknown as Org2CloudSyncClientDeps
  );
  vi.spyOn(tauri, "invokeTauri").mockImplementation(async (command) => {
    if (command === "es_get_child_sessions") return [] as never;
    throw new Error(
      `Unexpected Tauri command in CLI transcript fixture: ${command}`
    );
  });
  vi.spyOn(rpc.cli, "transcriptRevision").mockResolvedValue({ native: false });
  const mutation = vi.spyOn(rpc.cli, "historyMutation").mockResolvedValue(null);
  const chunks = vi
    .spyOn(rpc.cli, "chunks")
    .mockResolvedValue([{ id: "native-source" }] as never);
  eventStoreMock.getPersistedEvents.mockResolvedValue([
    makeEvent("mobile-user"),
  ]);
  processChunksRustMock.mockResolvedValue([
    makeEvent("user"),
    makeEvent("assistant"),
    makeEvent("tool"),
  ]);
  const push = async () => {
    sync.beginPass();
    sync.noteSessionEventActivity(session.session_id);
    await sync.pushSession(AUTH, "corg-1", session, SCOPE_KEY, access);
  };
  return { store, client, sync, mutation, chunks, push };
}

afterEach(() => vi.restoreAllMocks());

describe("CLI authoritative upload", () => {
  it("uploads the full transcript despite mobile cache rows, and reuses the clean plane", async () => {
    const { push, sync, chunks, client, store } = fixture();
    await push();
    expect(client.rewriteSessionEvents.mock.calls[0]?.[1]).toMatchObject({
      totalCount: 3,
    });
    expect(store.get(org2CloudPushCursorsAtom)[key]).toMatchObject({
      pushedCount: 3,
      cliHistoryEpoch: 0,
    });
    await sync.pushSession(AUTH, "corg-1", session, SCOPE_KEY, access);
    expect(chunks).toHaveBeenCalledTimes(1);
  });

  it("does not turn repeated nonempty short reads into cloud deletion", async () => {
    const { push, client, store } = fixture();
    await push();
    const before = store.get(org2CloudPushCursorsAtom)[key];
    processChunksRustMock.mockResolvedValue([makeEvent("user")]);
    await push();
    await push();
    await push();
    expect(client.rewriteSessionEvents).toHaveBeenCalledTimes(1);
    expect(client.appendSessionEvents).not.toHaveBeenCalled();
    expect(store.get(org2CloudPushCursorsAtom)[key]).toEqual(before);
  });

  it("allows a new explicit truncate, but cannot reuse it for another shrink", async () => {
    const { push, mutation, client, store } = fixture();
    await push();
    mutation.mockResolvedValue({
      sessionId: session.session_id,
      epoch: 1,
      reason: "message_truncate",
      mutatedAt: session.updated_at,
    });
    processChunksRustMock.mockResolvedValue([
      makeEvent("user"),
      makeEvent("assistant"),
    ]);
    await push();
    expect(store.get(org2CloudPushCursorsAtom)[key]).toMatchObject({
      pushedCount: 2,
      cliHistoryEpoch: 1,
    });
    processChunksRustMock.mockResolvedValue([makeEvent("user")]);
    await push();
    await push();
    expect(client.rewriteSessionEvents).toHaveBeenCalledTimes(2);
    expect(store.get(org2CloudPushCursorsAtom)[key]?.pushedCount).toBe(2);
  });

  it("propagates missing source and mutation races without overwriting the cloud", async () => {
    const { push, sync, chunks, mutation, client, store } = fixture();
    await push();
    const before = store.get(org2CloudPushCursorsAtom)[key];
    chunks.mockResolvedValueOnce([]);
    await expect(push()).rejects.toThrow("transcript unavailable");
    // A restart clears the transient retry backoff but preserves the cloud cursor.
    sync.reset();
    mutation.mockResolvedValueOnce(null).mockResolvedValueOnce({
      sessionId: session.session_id,
      epoch: 1,
      reason: "file_rewind",
      mutatedAt: session.updated_at,
    });
    await expect(push()).rejects.toThrow("history changed");
    expect(client.rewriteSessionEvents).toHaveBeenCalledTimes(1);
    expect(store.get(org2CloudPushCursorsAtom)[key]).toEqual(before);
  });

  it("repairs a legacy partial cursor even when its cache and remote summary agree", async () => {
    const { push, sync, store, client, chunks } = fixture();
    await push();
    const original = store.get(org2CloudPushCursorsAtom)[key];
    sync.reset();
    store.set(org2CloudPushCursorsAtom, {
      [key]: {
        ...original,
        pushedCount: 1,
        frozenEventCount: 1,
        cliHistoryEpoch: undefined,
        localContentRevision: 9,
        localContentUpdatedAt: session.updated_at,
      },
    });
    vi.spyOn(eventStoreMock, "getPersistedEventRevision").mockResolvedValue({
      eventCount: 1,
      revision: 9,
    });
    const remote = {
      ...buildCloudSessionMetadata(
        session,
        "corg-1",
        AUTH.userId,
        AUTH.profile?.displayName ?? AUTH.userId,
        SCOPE_KEY,
        access
      ),
      eventsEpoch: original.epoch,
      eventsFrozenSeq: original.frozenSeq,
      eventsCount: 1,
      eventsTailHash: original.tailHash ?? undefined,
    };
    chunks.mockClear();
    await sync.seedFromRemoteSummary(
      AUTH,
      "corg-1",
      session,
      SCOPE_KEY,
      access,
      remote
    );
    await sync.pushSession(AUTH, "corg-1", session, SCOPE_KEY, access);
    expect(chunks).toHaveBeenCalledTimes(1);
    expect(client.rewriteSessionEvents).toHaveBeenCalledTimes(2);
    expect(store.get(org2CloudPushCursorsAtom)[key]?.pushedCount).toBe(3);
  });

  it("reuses a verified CLI cursor after restart despite the synthetic cache", async () => {
    const { push, sync, store, chunks } = fixture();
    await push();
    const cursor = store.get(org2CloudPushCursorsAtom)[key];
    sync.reset();
    chunks.mockClear();
    const remote = {
      ...buildCloudSessionMetadata(
        session,
        "corg-1",
        AUTH.userId,
        "Me",
        SCOPE_KEY,
        access
      ),
      eventsEpoch: cursor.epoch,
      eventsFrozenSeq: cursor.frozenSeq,
      eventsCount: cursor.pushedCount,
      eventsTailHash: cursor.tailHash ?? undefined,
    };
    await sync.seedFromRemoteSummary(
      AUTH,
      "corg-1",
      session,
      SCOPE_KEY,
      access,
      remote
    );
    await sync.pushSession(AUTH, "corg-1", session, SCOPE_KEY, access);
    expect(chunks).not.toHaveBeenCalled();
  });

  it("loads the native assistant/tool tail and propagates read errors", async () => {
    const { chunks } = fixture();
    expect(
      (await loadCliSessionTranscript(session.session_id)).events.map(
        (event) => event.id
      )
    ).toEqual(["user", "assistant", "tool"]);
    chunks.mockRejectedValueOnce(new Error("source unreadable"));
    await expect(loadCliSessionTranscript(session.session_id)).rejects.toThrow(
      "source unreadable"
    );
  });
});

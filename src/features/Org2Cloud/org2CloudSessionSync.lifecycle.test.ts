import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { Org2CloudSyncClientDeps } from "./org2CloudSessionSync.types";
import {
  AUTH,
  SCOPE_KEY,
  SESSION,
  cleanupEngineFixture,
  createEngineFixture,
  engineTestDeps,
  eventStoreMock,
  localExecutionRevisionMock,
  makeClient,
  makeEvent,
} from "./org2CloudSyncEngine.testUtils";
import type { CloudSyncRequestOptions } from "./org2CloudSyncRequest.types";

const {
  Org2CloudSessionSync,
  SESSION_SEGMENT_UPLOAD_BATCH_SIZE,
  loadTurnIndex,
  org2CloudAuthAtom,
  org2CloudPushCursorsAtom,
  org2CloudPushedMetadataAtom,
  resetOrgEndpointDirectory,
  setOrgEndpointDirectory,
} = engineTestDeps;

vi.mock("@src/engines/SessionCore/storage/cacheAdapter", () => ({
  loadTurnIndex: vi.fn(),
}));
vi.mock("./org2CloudCapabilities", () => ({
  getCloudCapabilitiesConfirmed: vi.fn(async () => ({
    confirmed: true,
    capabilities: {},
  })),
}));

const fullAccess = {
  accessMode: "full_replay" as const,
  visibility: "org" as const,
};
const metadataAccess = { ...fullAccess, accessMode: "metadata_only" as const };
const key = "corg-1:session-1";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const engines: ReturnType<typeof createEngineFixture>[] = [];
const syncs: InstanceType<typeof Org2CloudSessionSync>[] = [];
afterEach(() => {
  for (const sync of syncs.splice(0)) sync.reset();
  for (const fixture of engines.splice(0)) cleanupEngineFixture(fixture.engine);
  resetOrgEndpointDirectory();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function fixture() {
  const store = createStore();
  store.set(org2CloudAuthAtom, AUTH);
  const client = {
    ...makeClient(),
    upsertSessionMetadata: vi.fn<
      Org2CloudSyncClientDeps["upsertSessionMetadata"]
    >(async () => {}),
    rewriteSessionEvents: vi.fn<
      Org2CloudSyncClientDeps["rewriteSessionEvents"]
    >(async () => {}),
    appendSessionEvents: vi.fn<Org2CloudSyncClientDeps["appendSessionEvents"]>(
      async () => {}
    ),
    deleteSession: vi.fn<Org2CloudSyncClientDeps["deleteSession"]>(
      async () => {}
    ),
    upsertSessionTurnIndex: vi.fn<
      NonNullable<Org2CloudSyncClientDeps["upsertSessionTurnIndex"]>
    >(async () => true),
  };
  const sync = new Org2CloudSessionSync(() => store, client);
  syncs.push(sync);
  localExecutionRevisionMock.mockResolvedValue("[]");
  eventStoreMock.getPersistedEvents.mockResolvedValue([makeEvent("one")]);
  eventStoreMock.getPersistedEventRevision.mockResolvedValue({
    eventCount: 1,
    revision: 1,
  });
  vi.mocked(loadTurnIndex).mockResolvedValue([]);
  return { store, client, sync };
}

describe("cloud session operation lifetime", () => {
  it.each(["stop", "account", "endpoint"])(
    "%s during the first rewrite prevents later batches and cursor commits",
    async (change) => {
      const f = createEngineFixture();
      engines.push(f);
      const firstBatch = deferred();
      const started = deferred();
      let request: CloudSyncRequestOptions | undefined;
      // Replace only the transport dependency; replay planning and both engine
      // and session lifecycles remain the production path.
      f.client.rewriteSessionEvents.mockImplementationOnce(async (...args) => {
        request = (
          args as unknown as [string, unknown, CloudSyncRequestOptions]
        )[2];
        started.resolve();
        await firstBatch.promise;
      });
      const payload = "x".repeat(260 * 1024);
      const events = Array.from(
        { length: SESSION_SEGMENT_UPLOAD_BATCH_SIZE + 1 },
        (_, index) =>
          ({
            ...makeEvent(`large-${index}`),
            payload: `${index}:${payload}`,
          }) as unknown as SessionEvent
      );
      eventStoreMock.getPersistedEvents.mockResolvedValue(events);
      const oldPass = f.engine.runSyncPass();
      await started.promise;
      const authBeforeSwitch = f.store.get(org2CloudAuthAtom);
      expect(request?.endpoint.supabaseUrl).toBe(AUTH.supabaseUrl);
      if (change === "stop") f.engine.stop();
      else if (change === "account")
        f.store.set(org2CloudAuthAtom, {
          ...AUTH,
          userId: "user-2",
          accessToken: "jwt-2",
        });
      else {
        setOrgEndpointDirectory([
          [
            "corg-1",
            {
              ...request!.endpoint,
              supabaseUrl: "https://replacement.example",
            },
          ],
        ]);
        expect(f.store.get(org2CloudAuthAtom)).toBe(authBeforeSwitch);
      }
      expect(request?.signal.aborted).toBe(true);
      await oldPass; // A fetch implementation that never settles cannot block stop.
      expect(f.client.appendSessionEvents).not.toHaveBeenCalled();
      expect(f.store.get(org2CloudPushCursorsAtom)[key]).toBeUndefined();
      firstBatch.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(f.client.appendSessionEvents).not.toHaveBeenCalled();
      expect(f.store.get(org2CloudPushCursorsAtom)[key]).toBeUndefined();
      expect(request?.endpoint.supabaseUrl).toBe(AUTH.supabaseUrl);
    }
  );

  it("an old metadata result cannot overwrite the restarted cache or impose retry backoff", async () => {
    const { sync, client, store } = fixture();
    const oldResponse = deferred();
    const started = deferred();
    client.upsertSessionMetadata.mockImplementationOnce(async () => {
      started.resolve();
      await oldResponse.promise;
    });
    const oldPush = sync.pushSession(
      AUTH,
      "corg-1",
      SESSION,
      SCOPE_KEY,
      metadataAccess
    );
    const cancelled = expect(oldPush).rejects.toMatchObject({
      name: "AbortError",
    });
    await started.promise;
    sync.reset();
    await cancelled;
    const renamed = { ...SESSION, name: "New generation" };
    await sync.pushSession(AUTH, "corg-1", renamed, SCOPE_KEY, metadataAccess);
    oldResponse.resolve();
    await Promise.resolve();
    await sync.pushSession(AUTH, "corg-1", renamed, SCOPE_KEY, metadataAccess);
    expect(client.upsertSessionMetadata).toHaveBeenCalledTimes(2);
    expect(store.get(org2CloudPushedMetadataAtom)[key]).toBe(true);
  });

  it("a revoked retract cannot clear markers written by the new identity", async () => {
    const { sync, client, store } = fixture();
    const response = deferred();
    const started = deferred();
    client.deleteSession.mockImplementationOnce(async () => {
      started.resolve();
      await response.promise;
    });
    const retract = sync.retractSession(AUTH, "corg-1", SESSION.session_id);
    const cancelled = expect(retract).rejects.toMatchObject({
      name: "AbortError",
    });
    await started.promise;
    store.set(org2CloudAuthAtom, { ...AUTH, userId: "user-2" });
    store.set(org2CloudPushedMetadataAtom, { [key]: true });
    const sentinel = {
      orgId: "corg-1",
      sessionId: SESSION.session_id,
      epoch: 42,
      frozenSeq: 0,
      pushedCount: 7,
      frozenEventCount: 0,
      frozenChainHash: "new",
      tailHash: null,
    };
    store.set(org2CloudPushCursorsAtom, { [key]: sentinel });
    await cancelled;
    response.resolve();
    await Promise.resolve();
    expect(store.get(org2CloudPushedMetadataAtom)[key]).toBe(true);
    expect(store.get(org2CloudPushCursorsAtom)[key]).toEqual(sentinel);
  });

  it("stop while loading the turn index cannot publish its stale result", async () => {
    const { sync, client } = fixture();
    const started = deferred();
    const index = deferred<Awaited<ReturnType<typeof loadTurnIndex>>>();
    vi.mocked(loadTurnIndex).mockImplementationOnce(async () => {
      started.resolve();
      return index.promise;
    });
    const push = sync.pushSession(
      AUTH,
      "corg-1",
      SESSION,
      SCOPE_KEY,
      fullAccess
    );
    const cancelled = expect(push).rejects.toMatchObject({
      name: "AbortError",
    });
    await started.promise;
    sync.reset();
    await cancelled;
    index.resolve([
      {
        sessionId: SESSION.session_id,
        turnId: "round-one",
        startSequence: 0,
        endSequence: 1,
        nextTurnId: null,
        startedAt: SESSION.created_at,
        endedAt: null,
        durationMs: null,
        userEventIds: ["one"],
        userPreview: "hello",
        eventCount: 1,
        bodyEventCount: 1,
        status: "completed",
        interrupted: false,
        modifiedFiles: [],
        resourceInteractions: [],
        gitArtifacts: [],
      },
    ]);
    await Promise.resolve();
    expect(client.upsertSessionTurnIndex).not.toHaveBeenCalled();
    expect(client.rewriteSessionEvents).toHaveBeenCalledTimes(1);
  });
});

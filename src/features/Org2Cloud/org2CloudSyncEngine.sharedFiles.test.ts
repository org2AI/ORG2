import { setTimeout as waitRealTime } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportedHistorySource } from "@src/api/tauri/externalHistory";

import {
  type EngineFixture,
  SESSION,
  cleanupEngineFixture,
  createEngineFixture,
  engineTestDeps,
  makeEvent,
  processChunksRustMock,
} from "./org2CloudSyncEngine.testUtils";
import { SHARED_FILE_QUOTA_RETRY_MS } from "./sessionSharedFileRetry";
import { SharedSessionFileRequestError } from "./sharedSessionFilesClient";

const { syncFiles } = vi.hoisted(() => ({ syncFiles: vi.fn() }));
vi.mock("./syncSessionSharedFiles", () => ({
  syncSessionSharedFiles: syncFiles,
}));
vi.mock("./org2CloudCapabilities", () => ({
  getCloudCapabilitiesConfirmed: vi.fn(async () => ({
    confirmed: true,
    capabilities: { sharedSessionFiles: true },
  })),
}));
const {
  getImportedHistorySourceBySessionId,
  sessionsAtom,
  org2CloudPushCursorsAtom,
  EXTERNAL_HISTORY_ACTIVITY_DEBOUNCE_MS,
} = engineTestDeps;

describe("imported replay attachment failure recovery", () => {
  let fixture: EngineFixture;
  beforeEach(() => {
    fixture = createEngineFixture();
    syncFiles.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    cleanupEngineFixture(fixture.engine);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([3, 7])(
    "drains %i capacity-deferred attachments without another user action",
    async (sessionCount) => {
      const { store, engine, client } = fixture;
      store.set(
        sessionsAtom,
        Array.from({ length: sessionCount }, (_, i) => ({
          ...SESSION,
          session_id: `session-slot-${i}`,
        }))
      );
      let release!: (ready: boolean) => void;
      const held = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      syncFiles
        .mockReturnValueOnce(held)
        .mockReturnValueOnce(held)
        .mockResolvedValue(true);
      await engine.runSyncPass();
      await vi.dynamicImportSettled();
      expect(client.rewriteSessionEvents).toHaveBeenCalledTimes(sessionCount);
      expect(syncFiles).toHaveBeenCalledTimes(2);
      release(true);
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          Object.values(store.get(org2CloudPushCursorsAtom)).every(
            (cursor) => cursor.sharedFilesVersion === 1
          )
        )
          break;
        await waitRealTime(10);
      }
      // Do not advance bootstrap/focus timers or manually run another pass:
      // completion itself must wake the session deferred by the slot limit.
      expect(syncFiles).toHaveBeenCalledTimes(sessionCount);
      expect(
        Object.values(store.get(org2CloudPushCursorsAtom)).every(
          (cursor) => cursor.sharedFilesVersion === 1
        )
      ).toBe(true);
    }
  );

  it.each(["stop", "hidden"])(
    "does not wake deferred work after %s",
    async (transition) => {
      const { store, engine } = fixture;
      store.set(
        sessionsAtom,
        [1, 2, 3].map((i) => ({ ...SESSION, session_id: `session-${i}` }))
      );
      let release!: (ready: boolean) => void;
      const held = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      syncFiles.mockReturnValue(held);
      await engine.runSyncPass();
      await vi.dynamicImportSettled();
      expect(syncFiles).toHaveBeenCalledTimes(2);
      if (transition === "stop") engine.stop();
      else
        vi.stubGlobal("document", {
          visibilityState: "hidden",
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        });
      const passes = engine.startedPassCount;
      release(true);
      await vi.dynamicImportSettled();
      await waitRealTime(30);
      expect(engine.startedPassCount).toBe(passes);
      expect(syncFiles).toHaveBeenCalledTimes(2);
      expect(
        Object.values(store.get(org2CloudPushCursorsAtom)).every(
          (cursor) => cursor.sharedFilesVersion !== 1
        )
      ).toBe(true);
    }
  );

  it("keeps bounded delta publication live during quota backoff, then backfills all skipped files", async () => {
    const { store, engine, client } = fixture;
    const sessionId = "cursoride-file-recovery";
    const source = getImportedHistorySourceBySessionId(
      sessionId
    ) as ImportedHistorySource &
      Required<
        Pick<ImportedHistorySource, "loadCloudTurnIds" | "loadCloudTurnWindows">
      >;
    const turnChunks = ["a", "b", "c", "d"].map((id) => ({
      chunk_id: id,
      function: "user_message",
    }));
    const events = turnChunks.map((chunk) => makeEvent(chunk.chunk_id));
    let count = 2;
    const full = vi
      .spyOn(source, "loadFullTranscriptChunks")
      .mockImplementation(async () => turnChunks.slice(0, count) as never);
    vi.spyOn(source, "loadCloudTurnIds").mockImplementation(async () =>
      turnChunks.slice(0, count).map((chunk) => chunk.chunk_id)
    );
    const windows = vi
      .spyOn(source, "loadCloudTurnWindows")
      .mockImplementation(async (_id, ids) =>
        ids.map((id) => ({
          turnId: id,
          chunks: [turnChunks.find((chunk) => chunk.chunk_id === id)!] as never,
        }))
      );
    processChunksRustMock.mockImplementation(async (chunks) =>
      chunks.map(
        (chunk) => events.find((event) => event.id === chunk.chunk_id)!
      )
    );
    async function publishVersion(version: number) {
      store.set(sessionsAtom, [
        {
          ...SESSION,
          session_id: sessionId,
          orgId: "personal-org",
          updated_at: new Date(1700000000000 + version * 60000).toISOString(),
        },
      ]);
      await engine.runSyncPass();
      vi.setSystemTime(Date.now() + EXTERNAL_HISTORY_ACTIVITY_DEBOUNCE_MS + 1);
      await engine.runSyncPass();
      await vi.dynamicImportSettled();
    }
    await publishVersion(1);
    const key = `corg-1:${sessionId}`;
    expect(store.get(org2CloudPushCursorsAtom)[key].sharedFilesVersion).toBe(1);
    full.mockClear();
    syncFiles.mockRejectedValue(
      new SharedSessionFileRequestError(
        "quota",
        400,
        false,
        "ORG2_QUOTA_EXCEEDED"
      )
    );
    count = 3;
    await publishVersion(2);
    expect(windows).toHaveBeenCalled();
    expect(full).not.toHaveBeenCalled();
    expect(store.get(org2CloudPushCursorsAtom)[key].pushedCount).toBe(3);
    expect(
      store.get(org2CloudPushCursorsAtom)[key].sharedFilesVersion
    ).toBeUndefined();
    count = 4;
    await publishVersion(3);
    expect(store.get(org2CloudPushCursorsAtom)[key].pushedCount).toBe(4);
    expect(full).not.toHaveBeenCalled();
    expect(syncFiles).toHaveBeenCalledTimes(2);
    expect(client.appendSessionEvents).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + SHARED_FILE_QUOTA_RETRY_MS);
    syncFiles.mockResolvedValue(true);
    await engine.runSyncPass();
    await vi.dynamicImportSettled();
    expect(full).toHaveBeenCalledTimes(1);
    expect(syncFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ events })
    );
    expect(store.get(org2CloudPushCursorsAtom)[key].sharedFilesVersion).toBe(1);
    expect(client.rewriteSessionEvents).toHaveBeenCalledTimes(1);
    expect(client.appendSessionEvents).toHaveBeenCalledTimes(2);
  });
});

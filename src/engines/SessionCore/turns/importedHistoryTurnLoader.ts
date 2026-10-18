import { importedHistoryTurnWindows } from "@src/api/tauri/externalHistory";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import {
  isCodexAppSession,
  isCursorIdeSession,
  isExternalHistorySession,
} from "@src/util/session/sessionDispatch";

import { createTurnBodyCommit } from "./turnBodyCommit";
import type { SessionTurnLoader } from "./types";

interface PendingImportedTurnBatch {
  owner: ReturnType<typeof createTurnBodyCommit>;
  turnIds: Set<string>;
  waiters: Array<{
    turnId: string;
    resolve: (loaded: boolean) => void;
    reject: (error: unknown) => void;
  }>;
  flushing: boolean;
}

const pendingBatches = new Map<string, PendingImportedTurnBatch>();

async function flushPendingBatch(
  sessionId: string,
  batch: PendingImportedTurnBatch
): Promise<void> {
  if (batch.flushing) return;
  batch.flushing = true;

  while (batch.turnIds.size > 0) {
    const turnIds = [...batch.turnIds];
    const waiters = batch.waiters.splice(0);
    batch.turnIds.clear();
    if (!batch.owner.isCurrent()) {
      for (const waiter of waiters) waiter.resolve(false);
      continue;
    }

    try {
      const windows = await importedHistoryTurnWindows({
        sessionId,
        turnIds,
      });
      const chunks = windows.flatMap((window) => window.chunks);
      let merged = false;
      if (batch.owner.isCurrent() && chunks.length > 0) {
        const events = await processChunksRust(chunks, sessionId);
        merged = await batch.owner.commit(events);
      }
      // Per-turn resolution: the wire names each window's turn, so a turn
      // whose window came back empty must NOT be marked loaded by its
      // batch-mates — that would disarm exactly the retry affordance the
      // loader contract exists to preserve.
      const loadedTurnIds = new Set(
        windows
          .filter((window) => window.chunks.length > 0)
          .map((window) => window.turnId)
      );
      for (const waiter of waiters) {
        waiter.resolve(merged && loadedTurnIds.has(waiter.turnId));
      }
    } catch (error) {
      for (const waiter of waiters) waiter.reject(error);
    }
  }

  if (pendingBatches.get(sessionId) === batch) pendingBatches.delete(sessionId);
}

function enqueueImportedTurnLoad(
  sessionId: string,
  turnId: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const existing = pendingBatches.get(sessionId);
    if (existing?.owner.isCurrent()) {
      existing.turnIds.add(turnId);
      existing.waiters.push({ turnId, resolve, reject });
      return;
    }

    const batch: PendingImportedTurnBatch = {
      owner: createTurnBodyCommit(sessionId),
      turnIds: new Set([turnId]),
      waiters: [{ turnId, resolve, reject }],
      flushing: false,
    };
    pendingBatches.set(sessionId, batch);
    queueMicrotask(() => {
      void flushPendingBatch(sessionId, batch).catch((error: unknown) => {
        for (const waiter of batch.waiters.splice(0)) waiter.reject(error);
        if (pendingBatches.get(sessionId) === batch)
          pendingBatches.delete(sessionId);
      });
    });
  });
}

export const importedHistoryTurnLoader: SessionTurnLoader = {
  async loadTurnBodyIntoStore({ sessionId, turnId }) {
    if (
      !isExternalHistorySession(sessionId) ||
      isCodexAppSession(sessionId) ||
      isCursorIdeSession(sessionId)
    ) {
      return false;
    }
    return enqueueImportedTurnLoad(sessionId, turnId);
  },
};

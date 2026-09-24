import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  captureLoadedTurnRegistryGeneration,
  isLoadedTurnRegistryGenerationCurrent,
} from "./loadedTurnRegistry";

/** Capture before reading. All adapters commit through this same boundary. */
export function createTurnBodyCommit(sessionId: string) {
  const generation = captureLoadedTurnRegistryGeneration(sessionId);
  const isCurrent = () =>
    isLoadedTurnRegistryGenerationCurrent(sessionId, generation);
  return {
    isCurrent,
    async commit(events: SessionEvent[]): Promise<boolean> {
      if (!isCurrent() || events.length === 0) return false;
      await eventStoreProxy.mergeRoundWindowEvents(events, sessionId);
      return isCurrent();
    },
  };
}

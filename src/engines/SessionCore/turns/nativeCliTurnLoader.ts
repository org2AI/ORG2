import { rpc } from "@src/api/tauri/rpc";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";

import { convertResultImages } from "../sync/adapters/cli/cliHistory";
import { captureLoadedTurnRegistryGeneration } from "./loadedTurnRegistry";
import type { SessionTurnLoader } from "./types";

export const nativeCliTurnLoader: SessionTurnLoader = {
  async loadTurnBodyIntoStore({ sessionId, turnId }) {
    const generation = captureLoadedTurnRegistryGeneration(sessionId);
    const events = await rpc.cli.history({
      sessionId,
      read: { kind: "turn", turnId },
    });
    if (
      !events.length ||
      captureLoadedTurnRegistryGeneration(sessionId) !== generation
    )
      return false;
    await eventStoreProxy.mergeRoundWindowEvents(
      events.map(convertResultImages),
      sessionId
    );
    return true;
  },
};

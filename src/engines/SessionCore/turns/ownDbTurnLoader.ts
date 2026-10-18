import { loadTurnBody } from "@src/engines/SessionCore/storage/cacheAdapter";

import { createTurnBodyCommit } from "./turnBodyCommit";
import type { SessionTurnLoader } from "./types";

export const ownDbTurnLoader: SessionTurnLoader = {
  async loadTurnBodyIntoStore({ sessionId, turnId }) {
    const owner = createTurnBodyCommit(sessionId);
    const turnWindow = await loadTurnBody(sessionId, turnId);
    // Empty ⇒ the body is not in the local cache (a cloud replay may still
    // be downloading it). Report not-loaded so retries stay armed.
    if (turnWindow.events.length === 0) return false;

    return owner.commit(turnWindow.events);
  },
};

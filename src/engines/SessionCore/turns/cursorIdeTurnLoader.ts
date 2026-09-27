import { cursorIdeTurnWindow } from "@src/api/tauri/externalHistory";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

import { createTurnBodyCommit } from "./turnBodyCommit";
import type { SessionTurnLoader } from "./types";

export const cursorIdeTurnLoader: SessionTurnLoader = {
  async loadTurnBodyIntoStore({ sessionId, turnId }) {
    if (!isCursorIdeSession(sessionId)) return false;

    // The public turn registry owns single-flight and its invalidation.
    const owner = createTurnBodyCommit(sessionId);
    const turnWindow = await cursorIdeTurnWindow({
      sessionId,
      userBubbleId: turnId,
    });
    const { chunks } = turnWindow;
    if (!owner.isCurrent() || !Array.isArray(chunks) || chunks.length === 0)
      return false;
    const events = await processChunksRust(chunks, sessionId);
    return owner.commit(events);
  },
};

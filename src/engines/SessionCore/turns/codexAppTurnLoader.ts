import { codexAppTurnWindow } from "@src/api/tauri/externalHistory";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import { isCodexAppSession } from "@src/util/session/sessionDispatch";

import { createTurnBodyCommit } from "./turnBodyCommit";
import type { SessionTurnLoader } from "./types";

export const codexAppTurnLoader: SessionTurnLoader = {
  async loadTurnBodyIntoStore({ sessionId, turnId }) {
    if (!isCodexAppSession(sessionId)) return false;
    const owner = createTurnBodyCommit(sessionId);

    const turnWindow = await codexAppTurnWindow({ sessionId, turnId });
    if (
      !owner.isCurrent() ||
      !Array.isArray(turnWindow.chunks) ||
      turnWindow.chunks.length === 0
    ) {
      return false;
    }
    const events = await processChunksRust(turnWindow.chunks, sessionId);
    return owner.commit(events);
  },
};

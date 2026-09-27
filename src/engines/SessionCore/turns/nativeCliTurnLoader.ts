import { rpc } from "@src/api/tauri/rpc";

import { convertResultImages } from "../sync/adapters/cli/cliHistory";
import { createTurnBodyCommit } from "./turnBodyCommit";
import type { SessionTurnLoader } from "./types";

export const nativeCliTurnLoader: SessionTurnLoader = {
  async loadTurnBodyIntoStore({ sessionId, turnId }) {
    const owner = createTurnBodyCommit(sessionId);
    const events = await rpc.cli.history({
      sessionId,
      read: { kind: "turn", turnId },
    });
    if (!owner.isCurrent()) return false;
    return owner.commit(events.map(convertResultImages));
  },
};

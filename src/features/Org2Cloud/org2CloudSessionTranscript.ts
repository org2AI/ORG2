import { rpc } from "@src/api/tauri/rpc";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import type { ActivityChunk } from "@src/types/session/session";

export interface CliReplayMutation {
  epoch: number;
  reason: string;
}

/** The cache may contain only synthetic mobile input; it is never CLI replay. */
export async function loadCliSessionTranscript(sessionId: string): Promise<{
  events: SessionEvent[];
  cliHistoryMutation: CliReplayMutation;
}> {
  const before = await rpc.cli.historyMutation({ sessionId });
  const chunks = (await rpc.cli.chunks({ sessionId })) as ActivityChunk[];
  const after = await rpc.cli.historyMutation({ sessionId });
  if ((before?.epoch ?? 0) !== (after?.epoch ?? 0)) {
    throw new Error(`CLI history changed while reading ${sessionId}`);
  }
  if (!chunks.length) {
    throw new Error(`CLI transcript unavailable for ${sessionId}`);
  }
  const events = await processChunksRust(chunks, sessionId);
  if (!events.length)
    throw new Error(`CLI replay unavailable for ${sessionId}`);
  return {
    events,
    cliHistoryMutation: {
      epoch: after?.epoch ?? 0,
      reason: after?.reason ?? "",
    },
  };
}

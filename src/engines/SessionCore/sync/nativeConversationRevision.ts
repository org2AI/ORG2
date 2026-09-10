import { loadLocalExecutionChildrenRevision } from "@src/engines/SessionCore/conversations/localConversationExecutionTail";

import { loadCliTranscriptRevision } from "./adapters/cli/cliHistory";

/** The visible managed conversation includes native continuation children. */
export async function loadNativeConversationRevision(
  sessionId: string
): Promise<string | null | undefined> {
  const rootRevision = await loadCliTranscriptRevision(sessionId);
  if (!rootRevision) return rootRevision;
  const childRevision = await loadLocalExecutionChildrenRevision({
    authority: "local-session",
    authorityScope: [],
    conversationId: sessionId,
  });
  if (childRevision === null) return null;
  return childRevision === "[]"
    ? rootRevision
    : JSON.stringify([rootRevision, childRevision]);
}

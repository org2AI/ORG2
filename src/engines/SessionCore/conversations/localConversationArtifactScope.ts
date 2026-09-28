import { getSession as getAgentSession } from "@src/api/tauri/agent";
import { rpc } from "@src/api/tauri/rpc";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isCliSession } from "@src/util/session/sessionDispatch";

import { CONVERSATION_ARTIFACT_ORIGIN_ARG } from "./conversationArtifactOrigin";
import { scopedNativeSourceEventIdOf } from "./nativeSourceEventIdentity";

/** Bind fresh output to the persisted execution workspace, including recovery. */
export async function scopeConversationArtifacts(
  sessionId: string,
  events: SessionEvent[]
): Promise<SessionEvent[]> {
  const needsScope = (event: SessionEvent) =>
    !event.repoPath &&
    !event.args?.[CONVERSATION_ARTIFACT_ORIGIN_ARG] &&
    !scopedNativeSourceEventIdOf(event) &&
    event.args?.__orgiiMaterialized !== true;
  if (!events.some(needsScope)) return events;

  // A selected composer target can differ from an automatic worktree or a
  // recovered execution. Credentials/model selection do not own file scope.
  const path = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : undefined;
  let repoPath: string | undefined;
  if (isCliSession(sessionId)) {
    const row = await rpc.cli.status({ sessionId });
    repoPath = path(row?.worktreePath) ?? path(row?.repoPath);
  } else {
    const row = await getAgentSession(sessionId);
    repoPath = path(row?.workspacePath);
  }
  // Unknown historical scope stays unknown; never borrow the receiver's path.
  if (!repoPath) return events;
  return events.map((event) =>
    needsScope(event) ? { ...event, repoPath } : event
  );
}

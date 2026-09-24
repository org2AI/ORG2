import type { SessionEvent } from "../core/types";

/** Presentation provenance, never part of provider message/tool semantics. */
export const CONVERSATION_ARTIFACT_ORIGIN_ARG = "__orgiiArtifactOrigin";
export interface ConversationArtifactOrigin {
  uploaderUserId: string;
  sessionId: string;
  revision: string;
  repoPath?: string;
}
export function conversationArtifactOriginOf(
  event: SessionEvent
): ConversationArtifactOrigin | null {
  const value = event.args?.[CONVERSATION_ARTIFACT_ORIGIN_ARG];
  if (!value || typeof value !== "object") return null;
  const origin = value as Record<string, unknown>;
  if (
    typeof origin.uploaderUserId !== "string" ||
    !origin.uploaderUserId ||
    typeof origin.sessionId !== "string" ||
    !origin.sessionId ||
    typeof origin.revision !== "string" ||
    !origin.revision ||
    (origin.repoPath !== undefined && typeof origin.repoPath !== "string")
  )
    return null;
  return origin as unknown as ConversationArtifactOrigin;
}

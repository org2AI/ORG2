/**
 * Durable identity of a canonical conversation's execution parent.
 *
 * `parentSessionId` on ordinary native/CLI Session rows groups hidden
 * execution episodes under a deterministic conversation parent; these helpers
 * encode and parse that grouping id and promote readable sessions to roots.
 */
import { isCliSession } from "@src/util/session/sessionDispatch";

import type { ConversationRootLocator } from "./conversationTypes";

function requireIdentityPart(label: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`conversation ${label} is required`);
  if (normalized.length > 2_048) {
    throw new Error(`conversation ${label} is too long`);
  }
  return normalized;
}

/** Durable grouping id stored directly on normal native/CLI Session rows. */
export function conversationExecutionParentId(
  locator: ConversationRootLocator
): string {
  if (locator.authorityScope.length > 16) {
    throw new Error("conversation authority scope has too many parts");
  }
  return JSON.stringify([
    "org2-conversation",
    1,
    requireIdentityPart("authority", locator.authority),
    locator.authorityScope.map((part, index) =>
      requireIdentityPart(`authority scope ${index}`, part)
    ),
    requireIdentityPart("id", locator.conversationId),
  ]);
}

/** Parse only parent ids emitted by `conversationExecutionParentId`. */
export function parseConversationExecutionParentId(
  value: string | null | undefined
): ConversationRootLocator | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 5 ||
      parsed[0] !== "org2-conversation" ||
      parsed[1] !== 1 ||
      typeof parsed[2] !== "string" ||
      !Array.isArray(parsed[3]) ||
      !parsed[3].every((part) => typeof part === "string") ||
      typeof parsed[4] !== "string"
    ) {
      return null;
    }
    return {
      authority: parsed[2],
      authorityScope: parsed[3] as string[],
      conversationId: parsed[4],
    };
  } catch {
    return null;
  }
}

/**
 * Promote a normal readable My Session to a canonical conversation root.
 * Target support is checked separately: any native transcript may be a source,
 * while only runtimes with a verified writer/reader adapter may execute it.
 */
export function localConversationRootForSession(
  sessionId: string,
  _cliAgentType: string | null | undefined,
  agentDefinitionId?: string | null
): ConversationRootLocator | null {
  // The session-id namespace already proves that this is a readable native
  // CLI conversation. Sidebar/lightweight rows can hydrate before their
  // `cliAgentType`; requiring that presentation metadata here made the
  // continuation binding disappear and left only the unrelated global model
  // picker. Target resolution remains strict and asks the user to choose a
  // runtime until the missing metadata arrives.
  if (!isCliSession(sessionId) && !agentDefinitionId) {
    return null;
  }
  return {
    authority: "local-session",
    authorityScope: [],
    conversationId: sessionId,
  };
}

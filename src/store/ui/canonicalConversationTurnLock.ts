/**
 * Process-wide exclusive lock for one canonical conversation root, so
 * cross-window turns for the same root are serialized.
 */
import {
  type ConversationRootLocator,
  conversationRootKey,
} from "@src/contracts/conversation";
import { QueuedConversationBusyError } from "@src/contracts/conversation";

const CONVERSATION_TURN_LOCK_PREFIX = "orgii:canonical-conversation:";

export async function withCanonicalConversationTurnLock<T>(
  root: ConversationRootLocator,
  run: () => Promise<T>
): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) {
    throw new Error("canonical conversation lock is unavailable");
  }
  const name = `${CONVERSATION_TURN_LOCK_PREFIX}${conversationRootKey(root)}`;
  let result:
    | { ok: true; value: T }
    | { ok: false; error: unknown }
    | undefined;
  try {
    result = (await locks.request(
      name,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          return {
            ok: false as const,
            error: new QueuedConversationBusyError(),
          };
        }
        try {
          return { ok: true as const, value: await run() };
        } catch (error) {
          return { ok: false as const, error };
        }
      }
    )) as typeof result;
  } catch {
    throw new Error("canonical conversation lock acquisition failed");
  }
  if (!result)
    throw new Error("canonical conversation lock returned no result");
  if (!result.ok) throw result.error;
  return result.value;
}

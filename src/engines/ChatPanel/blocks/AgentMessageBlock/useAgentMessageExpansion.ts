import { atom, useAtom } from "jotai";
import { useMemo, useRef } from "react";

import {
  isTurnBodyLoaded,
  loadSessionTurnBodyIntoStore,
  pruneLoadedTurnBodies,
} from "@src/engines/SessionCore/turns";
import { createLogger } from "@src/hooks/logger";

const log = createLogger("AgentMessageExpansion");
// UI intent only, isolated by Jotai store and bounded independently of bodies.
// A preview and its hydrated final response have different event IDs.
const expandedRepliesAtom = atom(new Set<string>());
const MAX_EXPANDED_REPLIES = 128;

export interface MessageTurnIdentity {
  sessionId: string;
  turnId: string;
}

export function readTruncatedResponseTurn(
  sessionId: string | null | undefined,
  result: unknown
): MessageTurnIdentity | undefined {
  if (!sessionId || !result || typeof result !== "object") return undefined;
  const unloaded = (result as Record<string, unknown>).unloadedTurn;
  if (!unloaded || typeof unloaded !== "object") return undefined;
  // Missing tool/activity bodies do not imply missing response text.
  // Use source metadata, never a natural ellipsis in the message.
  const { previewTruncated, turnId } = unloaded as Record<string, unknown>;
  if (previewTruncated !== true) {
    return undefined;
  }
  return typeof turnId === "string" && turnId.length > 0
    ? { sessionId, turnId }
    : undefined;
}

export function useAgentMessageExpansion(
  replyIdentity: MessageTurnIdentity | undefined,
  truncatedResponseTurn: MessageTurnIdentity | undefined
) {
  const replyKey = replyIdentity
    ? JSON.stringify([replyIdentity.sessionId, replyIdentity.turnId])
    : undefined;
  const state = useMemo(() => {
    if (!replyKey) return atom(false);
    return atom(
      (get) => get(expandedRepliesAtom).has(replyKey),
      (get, set, expanded: boolean) => {
        const next = new Set(get(expandedRepliesAtom));
        next.delete(replyKey);
        if (expanded) next.add(replyKey);
        while (next.size > MAX_EXPANDED_REPLIES) {
          const oldest = next.values().next().value;
          if (oldest === undefined) break;
          next.delete(oldest);
        }
        set(expandedRepliesAtom, next);
      }
    );
  }, [replyKey]);
  const [expanded, setExpanded] = useAtom(state);
  const pending = useRef(false);

  const toggle = async () => {
    if (pending.current) return;
    if (!truncatedResponseTurn) {
      setExpanded(!expanded);
      return;
    }
    pending.current = true;
    // Preserve intent before merging: hydration can replace this entire row.
    setExpanded(true);
    try {
      await loadSessionTurnBodyIntoStore(truncatedResponseTurn);
      if (
        !isTurnBodyLoaded(
          truncatedResponseTurn.sessionId,
          truncatedResponseTurn.turnId
        )
      ) {
        setExpanded(false);
        return;
      }
      await pruneLoadedTurnBodies(truncatedResponseTurn.sessionId, [
        truncatedResponseTurn.turnId,
      ]);
    } catch (error) {
      setExpanded(false);
      log.warn("Could not expand message turn", error);
    } finally {
      pending.current = false;
    }
  };

  // An evicted/reloaded preview must offer loading again, even if the reader
  // expanded its previous incarnation. No automatic refetch on mount.
  return {
    isExpanded: !truncatedResponseTurn && expanded,
    setExpanded,
    toggle,
  };
}

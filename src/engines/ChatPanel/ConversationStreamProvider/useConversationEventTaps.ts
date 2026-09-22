import { useCallback, useState } from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  buildConversationRunnerOverlay,
  conversationRunnerOverlaysEqual,
} from "@src/features/Org2Cloud/SessionConversation/conversationRunnerOverlay";

import type { ConversationActiveRunner } from "./conversationActiveDeliveries";

/** Latest chat events per tapped family member, keyed by bare session id. */
export function useMemberEventsByBareId() {
  const [eventsByBareId, setEventsByBareId] = useState<
    ReadonlyMap<string, readonly SessionEvent[]>
  >(() => new Map());
  const handleMemberEvents = useCallback(
    (bareSessionId: string, events: SessionEvent[]) => {
      setEventsByBareId((previous) => {
        if (previous.get(bareSessionId) === events) return previous;
        const next = new Map(previous);
        next.set(bareSessionId, events);
        return next;
      });
    },
    []
  );
  const handleMemberUnmount = useCallback((bareSessionId: string) => {
    setEventsByBareId((previous) => {
      if (!previous.has(bareSessionId)) return previous;
      const next = new Map(previous);
      next.delete(bareSessionId);
      return next;
    });
  }, []);
  return { eventsByBareId, handleMemberEvents, handleMemberUnmount };
}

interface UseRunnerOverlayByIdArgs {
  sessionId: string;
  activeRunners: readonly ConversationActiveRunner[];
  activeRunnerIds: ReadonlySet<string>;
}

/** Current-turn overlay projection per active runner session. */
export function useRunnerOverlayById({
  sessionId,
  activeRunners,
  activeRunnerIds,
}: UseRunnerOverlayByIdArgs) {
  const [runnerOverlayById, setRunnerOverlayById] = useState<
    ReadonlyMap<string, readonly SessionEvent[]>
  >(() => new Map());
  const handleRunnerEvents = useCallback(
    (runnerSessionId: string, events: SessionEvent[]) => {
      const runner = activeRunners.find(
        (candidate) => candidate.runnerSessionId === runnerSessionId
      );
      if (!runner) return;
      const overlay = buildConversationRunnerOverlay(runner, events, sessionId);
      setRunnerOverlayById((previous) => {
        if (
          conversationRunnerOverlaysEqual(
            previous.get(runnerSessionId),
            overlay
          )
        ) {
          return previous;
        }
        const next = new Map(
          [...previous].filter(([id]) => activeRunnerIds.has(id))
        );
        // Keep only the current-turn projection. Holding the full native
        // transcript here would pin a large imported/reused Session after the
        // EventStore subscription is gone.
        next.set(runnerSessionId, overlay);
        return next;
      });
    },
    [activeRunnerIds, activeRunners, sessionId]
  );
  const handleRunnerUnmount = useCallback((runnerSessionId: string) => {
    setRunnerOverlayById((previous) => {
      if (!previous.has(runnerSessionId)) return previous;
      const next = new Map(previous);
      next.delete(runnerSessionId);
      return next;
    });
  }, []);
  return { runnerOverlayById, handleRunnerEvents, handleRunnerUnmount };
}

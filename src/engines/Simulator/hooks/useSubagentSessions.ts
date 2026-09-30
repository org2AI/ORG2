import { useMemo } from "react";

import type { SubagentSession } from "@src/contracts/simulator/subagent";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { isActiveAtTimestamp } from "./subagentSessionProjection";
import { useSubagentRoster } from "./useSubagentRoster";

export type { SubagentSession } from "@src/contracts/simulator/subagent";
export {
  type ChildSessionRecord,
  SUBAGENT_ACTIVE_LEAD_MS,
  isActiveAtTimestamp,
  mapChildSessionRecord,
  extractSubagentSessionTaskTitle,
  extractSubagentSessionAgentName,
  stripAgentNamePrefix,
} from "./subagentSessionProjection";

/** The rail and monitor share one query owner per parent session. */
export function useSubagentSessions(
  parentSessionId: string | null,
  eventCount: number
): SubagentSession[] {
  return useSubagentRoster(parentSessionId, eventCount).sessions;
}

/**
 * From the full list of subagent sessions, return only those whose time
 * window covers the current replay cursor event.
 */
export function useActiveSubagentsAtCursor(
  allSubagents: SubagentSession[],
  cursorEvent: SessionEvent | null
): SubagentSession[] {
  return useMemo(() => {
    if (!cursorEvent || allSubagents.length === 0) {
      return [];
    }
    const cursorMs = new Date(cursorEvent.createdAt).getTime();
    return allSubagents.filter((sub) => isActiveAtTimestamp(sub, cursorMs));
  }, [allSubagents, cursorEvent]);
}

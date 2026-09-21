import { atom, useAtomValue } from "jotai";
import { useMemo, useState } from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isSessionEngineActiveAtom } from "@src/store/session/cliSessionStatusAtom";
import {
  hasLiveSubagentJobs,
  subagentJobMapAtom,
} from "@src/store/session/subagentJobAtom";
import { isExternalHistorySession } from "@src/util/session/sessionDispatch";
import { isSessionInProgress } from "@src/util/session/sessionInProgress";

import type { GroupChatContextValue } from "../GroupChatView/GroupChatContext";
import { isAgentOrgInboxTranscriptEvent } from "../GroupChatView/groupChatUtils";
import type { TailTurnPhase } from "./useChatGroupsProjection";

export function findTailTurnId(
  chatHistory: SessionEvent[],
  groupChat: GroupChatContextValue | null
): string | null {
  for (let index = chatHistory.length - 1; index >= 0; index--) {
    const event = chatHistory[index];
    if (!event?.id) continue;
    if (groupChat?.enabled) {
      if (groupChat.isCoordinatorTurnHeader(event)) return event.id;
      continue;
    }
    if (event.source === "user" && !isAgentOrgInboxTranscriptEvent(event)) {
      return event.id;
    }
  }
  return null;
}

interface ResolveTailTurnAgentWorkingOptions {
  activeId: string | null;
  isAgentWorking: boolean;
  sessionStatus: string | undefined;
}

/**
 * External-history rows get their live state from the normalized Session
 * status that also drives the sidebar dot. The foreground runtime atom is
 * authoritative for native sessions, but it does not track an independently
 * running Codex/Claude process.
 */
export function resolveTailTurnAgentWorking({
  activeId,
  isAgentWorking,
  sessionStatus,
}: ResolveTailTurnAgentWorkingOptions): boolean {
  if (!isExternalHistorySession(activeId)) return isAgentWorking;
  return isSessionInProgress(sessionStatus);
}

interface UseTailTurnPhaseOptions {
  activeId: string | null;
  chatHistory: SessionEvent[];
  disableTailCollapse: boolean;
  groupChat: GroupChatContextValue | null;
  sessionStatus: string | undefined;
}

/**
 * Completed turns show their summary and collapse immediately. Keep completion
 * latched to the displayed turn: dispatch can set the runtime running before
 * the next user event arrives. A new session/turn starts with a fresh latch.
 * Native completion requires the parent engine to be idle and all of this
 * session's subagents to have stopped. Live children also invalidate a previous
 * completion latch, so late child-start notifications cannot collapse live work.
 */
export function useTailTurnPhase({
  activeId,
  chatHistory,
  disableTailCollapse,
  groupChat,
  sessionStatus,
}: UseTailTurnPhaseOptions): TailTurnPhase {
  const isEngineWorking = useAtomValue(isSessionEngineActiveAtom);
  const liveChildrenAtom = useMemo(
    () => atom((get) => hasLiveSubagentJobs(get(subagentJobMapAtom), activeId)),
    [activeId]
  );
  const hasLiveChildren = useAtomValue(liveChildrenAtom);
  const [completion, setCompletion] = useState<{
    turnKey: string | null;
    complete: boolean;
  }>({ turnKey: null, complete: false });
  const tailTurnId = useMemo(
    () => findTailTurnId(chatHistory, groupChat),
    [chatHistory, groupChat]
  );
  const agentWorking = resolveTailTurnAgentWorking({
    activeId,
    isAgentWorking: isEngineWorking,
    sessionStatus,
  });
  const turnKey =
    !disableTailCollapse && activeId && tailTurnId
      ? `${activeId}:${tailTurnId}`
      : null;
  const complete =
    turnKey !== null &&
    !hasLiveChildren &&
    (!agentWorking || (completion.turnKey === turnKey && completion.complete));

  // Adjust this component's state only when the input-derived latch changes.
  // No timeout, delayed commit, or clock-based completion heuristic is needed.
  if (completion.turnKey !== turnKey || completion.complete !== complete) {
    setCompletion({ turnKey, complete });
  }
  return complete ? "complete" : "running";
}

import { createContext, useContext } from "react";

import type { AgentOrgRunMemberView } from "@src/api/tauri/agent";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

export interface GroupChatContextValue {
  enabled: boolean;
  coordinatorSessionId: string;
  orgMembers: ReadonlyArray<AgentOrgRunMemberView>;
  resolveSenderName: (event: SessionEvent) => string;
  resolveRecipientName: (event: SessionEvent) => string | null;
  isCoordinatorTurnHeader: (event: SessionEvent) => boolean;
  retryFailedMessage: (rowId: number, editedDisplayText?: string) => void;
}

const GroupChatContext = createContext<GroupChatContextValue | null>(null);

GroupChatContext.displayName = "GroupChatContext";

export function useGroupChatContext(): GroupChatContextValue | null {
  return useContext(GroupChatContext);
}

import { invokeTauri } from "@src/util/platform/tauri/init";

export interface AgentOrgHistoryDescriptor {
  mode: "current" | "history_only";
  rootSessionId: string | null;
  title: string | null;
  members: {
    sessionId: string;
    memberId: string | null;
    name: string | null;
  }[];
}

export interface AgentOrgHistoryItem {
  id: string;
  sourceSessionId: string | null;
  kind: string;
  content: string;
  createdAt: string;
}

export interface AgentOrgHistoryPage {
  items: AgentOrgHistoryItem[];
  nextCursor: string | null;
}

// Only pending requests are retained; opening two surfaces shares their lookup.
// Completed lookups leave no app-lifetime session cache to invalidate.
const pendingDescriptors = new Map<
  string,
  Promise<AgentOrgHistoryDescriptor | null>
>();

export function getAgentOrgHistoryDescriptor(sessionId: string) {
  const existing = pendingDescriptors.get(sessionId);
  if (existing) return existing;
  const request = invokeTauri<AgentOrgHistoryDescriptor | null>(
    "agent_org_history_descriptor",
    { sessionId }
  );
  if (pendingDescriptors.size < 128) {
    const pending = request.finally(() => {
      if (pendingDescriptors.get(sessionId) === pending)
        pendingDescriptors.delete(sessionId);
    });
    pendingDescriptors.set(sessionId, pending);
    return pending;
  }
  return request;
}

export function getAgentOrgHistoryPage(
  sessionId: string,
  cursor: string | null
) {
  return invokeTauri<AgentOrgHistoryPage>("agent_org_history_page", {
    sessionId,
    cursor,
    limit: 50,
  });
}

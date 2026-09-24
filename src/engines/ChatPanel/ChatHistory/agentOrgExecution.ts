import type { AgentOrgExecution } from "@src/engines/SessionCore/core/agentOrgHistory";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { OptimizedChatItem } from "./chatItemPipeline/types";

export type { AgentOrgExecution } from "@src/engines/SessionCore/core/agentOrgHistory";

export function agentOrgExecution(
  event: SessionEvent | undefined
): AgentOrgExecution | null {
  const value =
    event?.result?.agentOrgExecution ?? event?.args?.agentOrgExecution;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AgentOrgExecution>;
  return typeof candidate.turnIntentId === "string" &&
    candidate.turnIntentId.length > 0 &&
    typeof candidate.participantId === "string" &&
    typeof candidate.participantName === "string" &&
    [
      "user_input",
      "member_messages",
      "task_dispatch",
      "final_summary",
    ].includes(candidate.sourceKind ?? "")
    ? (candidate as AgentOrgExecution)
    : null;
}

export function itemEvent(item: OptimizedChatItem): SessionEvent | undefined {
  return (
    item.event ??
    item.readFileEvents?.[0] ??
    item.actionSummaryItems?.[0]?.event ??
    item.activityStackGroup?.events[0]
  );
}

export interface ExecutionGroup {
  header: OptimizedChatItem | null;
  items: OptimizedChatItem[];
  execution?: AgentOrgExecution;
}

/** Only formal identities supplied by the producer join rounds. No time/text heuristics. */
export function groupOrgExecutions(
  items: OptimizedChatItem[]
): ExecutionGroup[] {
  const known = new Map(
    items.flatMap((item) => {
      const execution = agentOrgExecution(itemEvent(item));
      return execution ? [[execution.turnIntentId, execution] as const] : [];
    })
  );
  const groups: ExecutionGroup[] = [];
  const byExecution = new Map<string, ExecutionGroup>();
  let legacy: ExecutionGroup | null = null;
  for (const item of items) {
    const event = itemEvent(item);
    const explicit = agentOrgExecution(event);
    const intent = event?.result?.turnIntentId ?? event?.args?.turnIntentId;
    const execution =
      explicit ?? (typeof intent === "string" ? known.get(intent) : undefined);
    if (execution) {
      legacy = null;
      let group = byExecution.get(execution.turnIntentId);
      if (!group) {
        group = { header: { ...item, event }, items: [], execution };
        byExecution.set(execution.turnIntentId, group);
        groups.push(group);
      }
      if (event?.actionType !== "agent_org_execution") group.items.push(item);
    } else {
      // Old records remain readable, but missing provenance never invents a
      // sender or joins unrelated records into a purported formal execution.
      if (!legacy || (event?.source === "user" && event.displayText)) {
        legacy = { header: event?.source === "user" ? item : null, items: [] };
        groups.push(legacy);
      }
      if (legacy.header !== item) legacy.items.push(item);
    }
  }
  return groups;
}

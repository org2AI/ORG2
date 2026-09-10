import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  getActionSummaryCategory,
  isFileModificationEvent,
  isMcpToolEvent,
} from "../../ChatHistory/chatItemPipeline/classifiers";
import {
  toolActivityCanonical,
  toolActivityGroup,
} from "../../ChatHistory/projection/compactToolActivity";

export function summarizeWorkActivity(events: readonly SessionEvent[]) {
  const counts = new Map<string, number>();
  const groups = new Set<string>();
  for (const event of events) {
    groups.add(toolActivityGroup(event));
    const category = getActionSummaryCategory(event);
    const canonical = toolActivityCanonical(event);
    const key = category
      ? `tools.exploreSummary.${category === "list" ? "ls" : category}`
      : isFileModificationEvent(event)
        ? "tools.editSummary.edit"
        : isMcpToolEvent(event)
          ? "tools.terminalSummary.mcp"
          : canonical === "run_shell"
            ? "tools.terminalSummary.command"
            : canonical === "await_output"
              ? "tools.terminalSummary.wait"
              : canonical === "inspect_terminals"
                ? "tools.terminalSummary.check"
                : "chat.actionCount";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    counts,
    group: groups.size === 1 ? groups.values().next().value! : "mixed",
  };
}

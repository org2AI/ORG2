import type { SessionToolActivity } from "@src/api/tauri/session/sessionSources";

type ToolAction = SessionToolActivity["actions"][number];
export type ToolActionKind = ToolAction["kind"];

export interface AggregatedToolActivityDetail {
  key: string;
  /** Latest occurrence supplies the displayed content; original records stay unchanged. */
  operation: SessionToolActivity;
  action: ToolAction;
  occurrenceCount: number;
  callIds: string[];
}

export interface ToolActivityCategory {
  kind: ToolActionKind;
  totalCount: number;
  details: AggregatedToolActivityDetail[];
}

/**
 * Presentation-only grouping of the newest-first activity stream. Exact meaning,
 * outcome and tool identity must agree; distinct errors/targets never collapse.
 */
export function aggregateToolActivity(
  operations: readonly SessionToolActivity[]
): ToolActivityCategory[] {
  const categories = new Map<ToolActionKind, ToolActivityCategory>();
  const detailsByKey = new Map<string, AggregatedToolActivityDetail>();
  const callsByKey = new Map<string, Set<string>>();
  for (const operation of operations) {
    const actions = operation.actions.length
      ? operation.actions
      : [{ kind: "generic" as const }];
    for (const action of actions) {
      let category = categories.get(action.kind);
      if (!category) {
        category = { kind: action.kind, totalCount: 0, details: [] };
        categories.set(action.kind, category);
      }
      category.totalCount += 1;
      const key = JSON.stringify([
        operation.toolName,
        action.kind,
        action.query ?? null,
        action.url ?? null,
        operation.status,
        operation.error ?? null,
      ]);
      const existing = detailsByKey.get(key);
      if (existing) {
        existing.occurrenceCount += 1;
        const calls = callsByKey.get(key)!;
        if (!calls.has(operation.callId)) {
          calls.add(operation.callId);
          existing.callIds.push(operation.callId);
        }
        continue;
      }
      const detail = {
        key,
        operation,
        action,
        occurrenceCount: 1,
        callIds: [operation.callId],
      };
      detailsByKey.set(key, detail);
      callsByKey.set(key, new Set(detail.callIds));
      category.details.push(detail);
    }
  }
  return [...categories.values()];
}

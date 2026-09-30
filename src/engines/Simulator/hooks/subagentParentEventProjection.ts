import type { SessionEvent } from "@src/engines/SessionCore/core/types";

export interface SubagentParentDetails {
  /** A task explicitly attached to this child by its parent's delegate event. */
  title?: string;
  /** Actual returned task text, never a generated status or a tool identifier. */
  summary?: string;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function subagentIdFromEvent(event: SessionEvent): string | undefined {
  if (
    event.actionType !== "tool_call" ||
    (event.functionName !== "subagent" && event.uiCanonical !== "subagent")
  )
    return undefined;
  return (
    nonEmptyString(event.args?.subagentSessionId) ??
    nonEmptyString(event.result?.subagentSessionId)
  );
}

export function subagentParentDetailsFromEvent(
  event: SessionEvent
): SubagentParentDetails {
  return {
    title:
      nonEmptyString(event.args?.description) ??
      nonEmptyString(event.args?.prompt),
    summary:
      nonEmptyString(event.result?.summary) ??
      nonEmptyString(event.result?.content),
  };
}

/** Project only explicit child links from the already-loaded parent transcript. */
export function projectSubagentParentDetails(
  events: readonly SessionEvent[]
): ReadonlyMap<string, SubagentParentDetails> {
  const details = new Map<string, SubagentParentDetails>();
  for (const event of events) {
    const id = subagentIdFromEvent(event);
    if (!id) continue;
    const next = subagentParentDetailsFromEvent(event);
    const previous = details.get(id);
    if (!next.title && !next.summary) continue;
    details.set(id, {
      title: previous?.title ?? next.title,
      summary: next.summary ?? previous?.summary,
    });
  }
  return details;
}

/** Preserve the simulator's existing prompt-first fallback semantics. */
export function subagentTaskTitleFromEvent(
  event: SessionEvent
): string | undefined {
  const details = subagentParentDetailsFromEvent(event);
  return nonEmptyString(event.args?.prompt) ?? details.title ?? details.summary;
}

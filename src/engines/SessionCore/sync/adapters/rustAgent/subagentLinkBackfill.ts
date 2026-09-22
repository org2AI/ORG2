import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { normalizeFunctionName } from "@src/util/data/activityData/activityNormalizers";
import { invokeTauri } from "@src/util/platform/tauri/init";

// ============================================================================
// Subagent Link Backfill
// ============================================================================

interface ChildSessionRecord {
  sessionId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  parentSessionId: string | null;
  parentEventId: string | null;
}

/**
 * Retroactively stamp `subagentSessionId` on parent `agent` tool_call events
 * that are missing the link. Older sessions were persisted before Rust began
 * stamping `subagentSessionId` into tool_call args, so the message-layer
 * `loadHistory` path never sees it. This queries `agent_sessions` for child
 * rows and matches them to unlinked parent events.
 *
 * Mutates `events` in-place for zero-copy efficiency.
 */
export async function backfillSubagentLinks(
  parentSessionId: string,
  events: SessionEvent[]
): Promise<void> {
  const hasSubagentId = (ev: SessionEvent): boolean => {
    const argsObj = ev.args as Record<string, unknown> | undefined;
    return Boolean(argsObj?.subagentSessionId);
  };
  const agentCalls = events.filter(
    (ev) =>
      ev.actionType === "tool_call" &&
      normalizeFunctionName(ev.functionName) === "subagent" &&
      !hasSubagentId(ev)
  );
  if (agentCalls.length === 0) return;

  let children: ChildSessionRecord[];
  try {
    children = await invokeTauri<ChildSessionRecord[]>(
      "es_get_child_sessions",
      { parentSessionId }
    );
  } catch {
    return;
  }
  if (children.length === 0) return;

  const byEventId = new Map<string, ChildSessionRecord>();
  const unmatched: ChildSessionRecord[] = [];
  for (const child of children) {
    if (child.parentEventId) {
      byEventId.set(child.parentEventId, child);
    } else {
      unmatched.push(child);
    }
  }

  const remainingCalls: SessionEvent[] = [];
  for (const ev of agentCalls) {
    const child = byEventId.get(ev.id);
    if (child) {
      stampSubagentArgs(ev, child.sessionId);
    } else {
      remainingCalls.push(ev);
    }
  }

  if (remainingCalls.length > 0 && unmatched.length > 0) {
    unmatched.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const limit = Math.min(remainingCalls.length, unmatched.length);
    for (let idx = 0; idx < limit; idx++) {
      stampSubagentArgs(remainingCalls[idx], unmatched[idx].sessionId);
    }
  }
}

function stampSubagentArgs(event: SessionEvent, childSessionId: string): void {
  const args = (event.args ?? {}) as Record<string, unknown>;
  args.subagentSessionId = childSessionId;
  args.action = args.action ?? "delegate";
  event.args = args as SessionEvent["args"];
}

import type { SubagentSession } from "@src/contracts/simulator/subagent";

export interface ChildSessionRecord {
  sessionId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sessionType: string;
  model?: string | null;
  totalTokens?: number;
  parentSessionId: string | null;
  parentEventId: string | null;
  /** Authoritative terminal flag computed by Rust from the status enum. */
  isTerminal: boolean;
  /** Clip right edge (last event timestamp); null while non-terminal. */
  endedAt: string | null;
}

/**
 * Zombie-row fuse: a non-terminal row whose `updated_at` is older than this
 * is treated as ended (clip closed at `updated_at`). Defends against legacy
 * rows stuck in a non-terminal status forever (pre-fix data) without a DB
 * migration. Not a normal-path mechanism.
 */
const ZOMBIE_ROW_FUSE_MS = 24 * 60 * 60 * 1000;

// The spawning tool_call is filtered out of the main slider, so the last
// visible main-agent event before a subagent starts can be up to ~60 s
// earlier than the subagent's startedAtMs. Treat that short lead window as
// active so even very fast workers can be inspected during replay.
export const SUBAGENT_ACTIVE_LEAD_MS = 90_000;

/**
 * Coarse display status for sorting/labels only. Clip-window semantics
 * (open/closed) come exclusively from `isTerminal` / `endedAt`.
 */
function mapStatus(
  raw: string,
  isTerminal: boolean
): SubagentSession["status"] {
  if (raw === "completed") return "completed";
  if (isTerminal) return "failed";
  if (raw === "running" || raw === "streaming") return "running";
  return "pending";
}

/**
 * Rust persists delegate child `name` as `AgentName (task text)` (see agent tool
 * `upsert_session`). For grid titles we show only the task portion, not
 * `Explore (…)`.
 */
export function extractSubagentSessionTaskTitle(rawName: string): string {
  const marker = " (";
  const idx = rawName.indexOf(marker);
  if (idx === -1) return rawName;
  const afterOpen = rawName.slice(idx + marker.length);
  const lastClose = afterOpen.lastIndexOf(")");
  if (lastClose < 0) return rawName;
  return afterOpen.slice(0, lastClose).trim();
}

/**
 * A subagent row is considered "assigned a task" iff the parsed task
 * portion of its name is non-empty. Rust persists delegate child
 * sessions as `AgentName (task text)` via `upsert_session`, so a child
 * with no task either:
 *
 *   - was created without a delegated payload (e.g. parent stamped the
 *     child id before the delegate tool actually filled out the task), or
 *   - is a placeholder row from a failed/canceled spawn.
 *
 * In both cases, opening a ChatHistory panel for that subagent shows a
 * "failed to load" placeholder because there is nothing to render — so
 * we drop the row at the data source instead of papering over it in
 * each consumer (grid cell, PIP card, multi-event subscription).
 */
export function isSubagentTaskAssigned(rawName: string): boolean {
  return extractSubagentSessionTaskTitle(rawName).trim().length > 0;
}

/**
 * Strip a leading `{agentName}` prefix (optionally followed by `:`, `-`,
 * or `·`) from the task title so a row labelled `Planner` doesn't render
 * as `Planner · Planner: Breaks down …`. Rust populates the parenthetical
 * with `<AgentName>: <description>` for some delegate variants, which is
 * useful when the title stands alone but redundant in our two-line
 * (name · description) cell header.
 */
export function stripAgentNamePrefix(
  taskTitle: string,
  agentName: string
): string {
  const trimmedTitle = taskTitle.trim();
  const trimmedName = agentName.trim();
  if (!trimmedName) return trimmedTitle;
  if (!trimmedTitle.toLowerCase().startsWith(trimmedName.toLowerCase())) {
    return trimmedTitle;
  }
  const rest = trimmedTitle.slice(trimmedName.length).trimStart();
  // Strip a single separator if it's the first character after the name.
  const stripped = rest.replace(/^[:\-·•—]\s*/u, "");
  return stripped.length > 0 ? stripped : trimmedTitle;
}

export function extractSubagentSessionAgentName(rawName: string): string {
  const parenIndex = rawName.indexOf(" (");
  const dotIndex = rawName.indexOf(" · ");
  const bulletIndex = rawName.indexOf(" • ");
  const splitIndex = [parenIndex, dotIndex, bulletIndex]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  if (splitIndex === undefined) return rawName.trim();
  return rawName.slice(0, splitIndex).trim();
}

/**
 * Check whether a subagent's time window covers a given cursor timestamp.
 */
export function isActiveAtTimestamp(
  sub: SubagentSession,
  cursorMs: number
): boolean {
  if (cursorMs < sub.startedAtMs - SUBAGENT_ACTIVE_LEAD_MS) return false;
  if (sub.endedAtMs === null) return true;
  return cursorMs <= sub.endedAtMs;
}

/**
 * Map one backend record into a SubagentSession clip.
 *
 * Pure + exported for tests. `nowMs` is injected so the zombie-row fuse
 * is deterministic under test.
 */
export function mapChildSessionRecord(
  record: ChildSessionRecord,
  nowMs: number
): SubagentSession {
  const status = mapStatus(record.status, record.isTerminal);
  const startedAtMs = new Date(record.createdAt).getTime();

  let endedAtMs = record.endedAt ? new Date(record.endedAt).getTime() : null;
  if (endedAtMs === null && !record.isTerminal) {
    // Zombie-row fuse — see ZOMBIE_ROW_FUSE_MS.
    const updatedAtMs = new Date(record.updatedAt).getTime();
    if (nowMs - updatedAtMs > ZOMBIE_ROW_FUSE_MS) {
      endedAtMs = updatedAtMs;
    }
  }

  const rawName = record.name || record.sessionId;
  const agentName = extractSubagentSessionAgentName(rawName);
  const taskTitle = extractSubagentSessionTaskTitle(rawName);

  return {
    key: record.sessionId,
    sessionId: record.sessionId,
    name: agentName,
    description: stripAgentNamePrefix(taskTitle, agentName),
    sessionType: record.sessionType,
    status,
    isBackground: true,
    startedAtMs,
    endedAtMs,
    isTerminal: record.isTerminal,
    rawStatus: record.status,
    model: record.model ?? undefined,
    totalTokens: record.totalTokens,
  };
}

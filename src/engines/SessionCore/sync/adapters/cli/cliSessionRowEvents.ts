/**
 * Session-row projections of CLI worktree broadcasts: the worktree-created
 * and merge-result frames upsert the session catalog row directly.
 */
import type { MergeStatus } from "@src/api/tauri/rpc/schemas/validation";
import { upsertSession } from "@src/store/session/sessionAtom/mutations";

import type { RawSessionEvent } from "../../types";

export function handleWorktreeCreated(
  msgSessionId: string,
  raw: RawSessionEvent
): void {
  // Neither `code_session.worktree_created`
  // (src-tauri/src/agent_sessions/cli/commands/create.rs) nor
  // `code_session.merge_result`
  // (src-tauri/src/agent_sessions/cli/commands/worktree.rs) carries a
  // timestamp on the wire, and both are broadcast at the instant the
  // work completes — so "now" IS the row's real creation time when this
  // frame is the first sighting of the session. Empty strings here used
  // to reach `upsertSession`'s INSERT path verbatim (the UPDATE path
  // pins the prior row's values), and `taskTimestamps.ts` reads an empty
  // timestamp as 0, sorting the session to the epoch and dropping it out
  // of every Kanban time window.
  const now = new Date().toISOString();
  upsertSession({
    session_id: msgSessionId,
    worktreePath: raw.worktree_path as string | undefined,
    worktreeBranch: raw.branch as string | undefined,
    baseBranch: raw.base_branch as string | undefined,
    mergeStatus: "pending",
    created_at: now,
    updated_at: now,
    status: "pending",
  });
}

export function handleMergeResult(
  msgSessionId: string,
  raw: RawSessionEvent
): void {
  const status = raw.status as MergeStatus | undefined;
  if (status) {
    const now = new Date().toISOString();
    upsertSession({
      session_id: msgSessionId,
      mergeStatus: status,
      created_at: now,
      updated_at: now,
      status: "completed",
    });
  }
}

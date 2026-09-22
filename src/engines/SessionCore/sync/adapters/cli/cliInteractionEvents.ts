/**
 * Pending-interaction broadcasts for a CLI session: plan-approval lifecycle
 * frames feeding the Build card atom and hook/ACP permission requests.
 */
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { normalizeChunkRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import { createLogger } from "@src/hooks/logger";
import {
  pendingPermissionRequestsAtom,
  upsertPendingPermissionRequest,
} from "@src/store/session/permissionRequestAtom";
import {
  clearPendingPlanApproval,
  pendingPlanApprovalsAtom,
  upsertPendingPlanApproval,
} from "@src/store/session/planApprovalAtom";
import type { ActivityChunk } from "@src/types/session/session";

import type { RawSessionEvent } from "../../types";
import type { PermissionRequestEvent } from "../shared/types";
import {
  asNumber,
  asString,
  getStore,
  rawNumber,
  rawString,
  withTurnIntentId,
} from "./cliEventHandlerHelpers";

const log = createLogger("CliAdapter");

export function handlePlanReadyForApproval(
  sessionId: string,
  raw: RawSessionEvent
): void {
  const store = getStore();
  if (!store) return;
  const planPath = rawString(raw, "planPath");
  if (!planPath) return;
  store.set(pendingPlanApprovalsAtom, (prev) =>
    upsertPendingPlanApproval(prev, {
      sessionId,
      planPath,
      planTitle: rawString(raw, "planTitle") ?? "",
      planContent: rawString(raw, "planContent") ?? "",
      toolCallId: rawString(raw, "toolCallId"),
      planId: rawString(raw, "planId"),
      planRevisionId: rawString(raw, "planRevisionId"),
      originToolCallId: rawString(raw, "originToolCallId"),
      autoApproveAt: rawNumber(raw, "autoApproveAt"),
    })
  );
}

export function handleExitPlanMode(
  sessionId: string,
  raw: RawSessionEvent
): void {
  const store = getStore();
  if (!store) return;
  store.set(pendingPlanApprovalsAtom, (prev) =>
    clearPendingPlanApproval(prev, sessionId, rawString(raw, "toolCallId"))
  );
}

// Abandoned / orphaned / superseded resolutions arrive only as this
// broadcast (no paired exit_plan_mode), so clear the pending Build card.
export function handlePlanApprovalArchivedBroadcast(
  sessionId: string,
  raw: RawSessionEvent
): void {
  const store = getStore();
  if (!store) return;
  store.set(pendingPlanApprovalsAtom, (prev) =>
    clearPendingPlanApproval(
      prev,
      sessionId,
      rawString(raw, "planRevisionId") ?? rawString(raw, "toolCallId")
    )
  );
}

export function handleCliPermissionRequest(
  sessionId: string,
  raw: RawSessionEvent
): void {
  const origin = raw.origin;
  if (origin !== "cli_hook" && origin !== "acp" && origin !== "native_cli")
    return;
  const requestId = rawString(raw, "requestId");
  if (!requestId) return;
  const permissionEvent: PermissionRequestEvent = {
    requestId,
    sessionId,
    tool: rawString(raw, "toolName") ?? rawString(raw, "tool") ?? "unknown",
    toolCallId: rawString(raw, "toolCallId"),
    args:
      raw.toolArgs && typeof raw.toolArgs === "object"
        ? (raw.toolArgs as Record<string, unknown>)
        : {},
    origin,
  };
  getStore()?.set(pendingPermissionRequestsAtom, (prev) =>
    upsertPendingPermissionRequest(prev, permissionEvent)
  );
}

/**
 * A `plan_approval` chunk feeds TWO independent sinks, and only one of them
 * needs a path:
 *
 *   1. `pendingPlanApprovalsAtom` — the Build card. It keys off `planPath`
 *      (that is where an approval writes the file back), so no path means
 *      no card. That guard is legitimate and stays.
 *   2. The event store — the transcript row. It never reads `planPath`
 *      (`PlanDocAdapter` renders from `title` / `content` / the plan ids),
 *      so a path-less plan still renders.
 *
 * Both used to sit behind the same `planPath` guard, so a chunk with no
 * path was dropped whole and the plan vanished from the transcript with no
 * trace. Rust emits `"planPath": ""` whenever the snapshot has no path
 * (agent-core `interaction/plan_approval/events.rs`), and `asString`
 * rejects `""` — so this was the ordinary empty-path case, not a
 * malformed-frame edge. Only the card is skipped now; the transcript row
 * is written either way, and the skip is logged.
 */
export function handlePlanApprovalActivity(
  sessionId: string,
  chunk: ActivityChunk,
  turnIntentId: string | undefined,
  persistObservedEvent: (operation: Promise<unknown>) => void
): boolean {
  if (chunk.action_type !== "plan_approval") return false;
  const args = chunk.args ?? {};
  const planPath = asString(args.planPath);
  const store = getStore();
  if (!planPath) {
    log.warn(
      "[CliAdapter] plan_approval chunk missing planPath — transcript row kept, Build card skipped:",
      chunk.chunk_id
    );
  } else if (store) {
    // Synchronous, ahead of the normalize RPC: the Build card must not
    // depend on Rust normalization succeeding.
    store.set(pendingPlanApprovalsAtom, (prev) =>
      upsertPendingPlanApproval(prev, {
        sessionId,
        planPath,
        planTitle: asString(args.title) ?? "",
        planContent: asString(args.content) ?? "",
        toolCallId: asString(args.planRevisionId),
        planId: asString(args.planId),
        planRevisionId: asString(args.planRevisionId),
        originToolCallId: asString(args.originToolCallId),
        autoApproveAt: asNumber(args.autoApproveAt),
      })
    );
  }
  persistObservedEvent(
    normalizeChunkRust(chunk, sessionId).then((event) =>
      eventStoreProxy.upsert(withTurnIntentId(event, turnIntentId), sessionId)
    )
  );
  return true;
}

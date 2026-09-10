import { getPendingPlanApproval } from "@src/api/tauri/agent";
import {
  type PlanApprovalStateMap,
  type SessionPlanApprovalState,
  clearPendingPlanApproval,
  upsertPendingPlanApproval,
} from "@src/store/session/planApprovalAtom";

export function rehydratePendingPlanApproval(
  sessionId: string,
  abortController: AbortController,
  setPendingPlanApprovals: (
    update: (prev: PlanApprovalStateMap) => PlanApprovalStateMap
  ) => void
): void {
  // Jotai functional setters run synchronously. Capture the session slot, not
  // the whole map: another session's update must not invalidate this fetch.
  let initialState: SessionPlanApprovalState | undefined;
  setPendingPlanApprovals((prev) => {
    initialState = prev.get(sessionId);
    return prev;
  });
  const rehydrate = async () => {
    try {
      const snapshot = await getPendingPlanApproval(sessionId);
      // Guard: abort signal may have fired while the RPC was in flight.
      if (abortController.signal.aborted) return;
      setPendingPlanApprovals((prev) => {
        // A live push, save, finalization, or another completed fetch wins
        // over any snapshot sampled before that mutation, including null.
        if (prev.get(sessionId) !== initialState) return prev;
        return snapshot
          ? upsertPendingPlanApproval(prev, snapshot)
          : clearPendingPlanApproval(prev, sessionId);
      });
    } catch {
      // Non-critical: the Build button stays disabled until Rust broadcasts
      // agent:plan_ready_for_approval again.
    }
  };

  void rehydrate();
}

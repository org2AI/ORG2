import type {
  AgentOrgTask,
  AgentOrgTaskExecutionHandoffReceipt,
  AgentOrgTaskExecutionHandoffResolution,
} from "@src/api/tauri/agent";
import { createLogger } from "@src/hooks/logger";

export const logger = createLogger("AgentOrgOverviewPanel");

export function reportUnexpectedHistoryLoadError(error: unknown): void {
  logger.error("Unexpected Agent Team Task history failure:", error);
}

// Keep the opposite control disabled briefly after Pause/Resume settles. The
// two controls occupy the same toolbar position, so the second click of a
// double-click can otherwise land on the newly rendered inverse action.
export const PAUSE_TOGGLE_GESTURE_COOLDOWN_MS = 500;

export interface TaskActionDialogState {
  task: AgentOrgTask;
  action: "cancel" | "reassign";
}

export interface HandoffResolutionDialogState {
  receipt: AgentOrgTaskExecutionHandoffReceipt;
  resolution: AgentOrgTaskExecutionHandoffResolution;
}

import { invokeTauri } from "@src/util/platform/tauri/init";

import type { DeleteSessionReceipt } from "../types";
import type {
  AgentOrgArchiveTeardownSummary,
  AgentOrgFinalSummaryReceipt,
} from "./runView";
import { publishAgentOrgStateChange } from "./stateChanges";

export interface ArchiveRunOutcome {
  requestId: string;
  runId: string;
  receiptId: string;
  transitioned: boolean;
  archiveGeneration: number;
  archivedAt: string;
  cancellations: {
    tasks: number;
    turns: number;
    inboxDeliveries: number;
    planApprovals: number;
    interventions: number;
    pauseContinuations: number;
  };
  teardown: AgentOrgArchiveTeardownSummary;
}

export interface PauseRunOutcome {
  requestId: string;
  runId: string;
  episodeId: string;
  transitioned: boolean;
  pauseGeneration: number;
  capturedTurnCount: number;
  drainingTurnCount: number;
  timedOutTurnCount: number;
}

export interface ResumeRunOutcome {
  requestId: string;
  runId: string;
  episodeId: string;
  transitioned: boolean;
  resumeGeneration: number;
  continuationCount: number;
  skippedCount: number;
}

export async function retryAgentOrgFinalSummary(input: {
  sessionId: string;
  certificateId: string;
  failedAttempt: number;
  requestId?: string;
}): Promise<AgentOrgFinalSummaryReceipt> {
  const receipt = await invokeTauri<AgentOrgFinalSummaryReceipt>(
    "agent_org_final_summary_retry",
    {
      ...input,
      requestId: input.requestId ?? crypto.randomUUID(),
    }
  );
  publishAgentOrgStateChange(input.sessionId);
  return receipt;
}

export async function pauseAgentOrgRun(
  sessionId: string,
  requestId: string = crypto.randomUUID()
): Promise<PauseRunOutcome> {
  const outcome = await invokeTauri<PauseRunOutcome>("agent_org_pause_run", {
    sessionId,
    requestId,
  });
  publishAgentOrgStateChange(sessionId);
  return outcome;
}

export async function resumeAgentOrgRun(
  sessionId: string,
  requestId: string = crypto.randomUUID()
): Promise<ResumeRunOutcome> {
  const outcome = await invokeTauri<ResumeRunOutcome>("agent_org_resume_run", {
    sessionId,
    requestId,
  });
  publishAgentOrgStateChange(sessionId);
  return outcome;
}

export async function archiveAgentOrgRun(
  sessionId: string,
  requestId: string = crypto.randomUUID()
): Promise<ArchiveRunOutcome> {
  const outcome = await invokeTauri<ArchiveRunOutcome>(
    "agent_org_archive_run",
    { sessionId, requestId }
  );
  publishAgentOrgStateChange(sessionId);
  return outcome;
}

export async function deleteAgentOrgTeam(
  sessionId: string
): Promise<DeleteSessionReceipt> {
  return invokeTauri<DeleteSessionReceipt>("agent_org_delete_team", {
    sessionId,
  });
}

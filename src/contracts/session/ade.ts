/**
 * ADE (agent-driven environment) manager contracts.
 *
 * `store/session/adeManagerPaletteAtom` holds this state; the
 * `scaffold/GlobalSpotlight` palette and `engines/SessionCore` ADE actions
 * render and produce it.
 */

export type AdeManagerRunStatus = "idle" | "sending" | "running" | "error";
export type AdeManagerActivityStatus = "running" | "completed" | "failed";

export interface AdeManagerActivityItem {
  id: string;
  title: string;
  detail: string;
  status: AdeManagerActivityStatus;
  isMarkdown?: boolean;
}

/** A session launch proposed by an ADE action, awaiting user confirmation. */
export interface PendingSessionProposal {
  correlationId: string;
  task: string;
  agentDefinitionId?: string;
  repoPath?: string;
  model?: string;
  expiresAt: number;
}

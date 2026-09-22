import type {
  AgentOrgMemberIntervention,
  AgentOrgRunMemberView,
  AgentOrgRunStatus,
  ReturnToWorkResult,
} from "@src/api/tauri/agent";

export interface StreamRetryInfo {
  kind: string;
  attempt: number;
  maxAttempts: number;
}

export interface AgentOrgInterventionView {
  intervention: AgentOrgMemberIntervention | null;
  member: AgentOrgRunMemberView;
  runStatus: AgentOrgRunStatus | null;
  error: string | null;
  returning: boolean;
  stopping: boolean;
  onReturnToWork: () => Promise<ReturnToWorkResult | null>;
  onStopUserDirectedWork: () => Promise<boolean>;
}

export interface GroupChatPendingMessageView {
  targetMemberName: string;
  retryError: string | null;
  retrying: boolean;
  onRetry: () => Promise<void>;
}

export interface CanvasPreviewPillView {
  label: string;
  onOpen: () => void;
}

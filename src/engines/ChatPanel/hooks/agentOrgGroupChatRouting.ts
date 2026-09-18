import {
  AGENT_ORG_RUN_STATUS,
  type AgentOrgRunMemberView,
  type AgentOrgRunView,
} from "@src/api/tauri/agent";

export function isDirectAgentOrgMemberView(
  currentAgentOrgMember: AgentOrgRunMemberView | null
): boolean {
  return currentAgentOrgMember !== null && !currentAgentOrgMember.isCoordinator;
}

export function shouldRouteAgentOrgGroupChatSubmit(
  groupChatViewActive: boolean,
  directMemberView: boolean,
  memberMentionCount: number
): boolean {
  if (directMemberView) return false;
  return groupChatViewActive || memberMentionCount > 0;
}

export function shouldUseAgentOrgMemberGroupTransport(
  targetMemberIds: ReadonlyArray<string>
): boolean {
  return targetMemberIds.length > 0;
}

export function shouldBlockPausedAgentOrgGroupChatSubmit(
  runStatus: AgentOrgRunView["runStatus"],
  targetMemberIds: ReadonlyArray<string>
): boolean {
  return (
    runStatus === AGENT_ORG_RUN_STATUS.PAUSED && targetMemberIds.length === 0
  );
}

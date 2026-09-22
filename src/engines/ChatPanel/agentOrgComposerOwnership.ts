interface AgentOrgComposerSessionIdentity {
  parentSessionId?: string | null;
  orgMemberId?: string | null;
}

/**
 * A materialized non-Coordinator Member owns its composer execution directly.
 * The parent/root Session may still own the surrounding Agent Org surface,
 * but it must not supply that Member's model binding or canonical dispatch.
 */
export function isAgentOrgMemberDirectTarget(
  session: AgentOrgComposerSessionIdentity | null | undefined
): boolean {
  return Boolean(
    session?.parentSessionId &&
    session.orgMemberId &&
    session.orgMemberId !== "coordinator"
  );
}

export function resolveAgentOrgComposerExecutionOwnership<T>(
  session: AgentOrgComposerSessionIdentity | null | undefined,
  outerBinding: T | null
): {
  isDirectAgentOrgMember: boolean;
  executionBinding: T | null;
} {
  const isDirectAgentOrgMember = isAgentOrgMemberDirectTarget(session);
  return {
    isDirectAgentOrgMember,
    executionBinding: isDirectAgentOrgMember ? null : outerBinding,
  };
}

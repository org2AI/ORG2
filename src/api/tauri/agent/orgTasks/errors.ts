export const AGENT_ORG_FINALIZING_INPUT_NOT_ACCEPTED =
  "agent_org_finalizing_input_not_accepted";
export const AGENT_ORG_HISTORY_READ_ONLY = "agent_org_history_read_only";

export function isAgentOrgFinalizingInputError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === AGENT_ORG_FINALIZING_INPUT_NOT_ACCEPTED ||
    message.includes(`${AGENT_ORG_FINALIZING_INPUT_NOT_ACCEPTED}:`)
  );
}

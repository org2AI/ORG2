import type { SessionEvent } from "@src/engines/SessionCore/core/types";

export function isAgentOrgInboxTranscriptEvent(event: SessionEvent): boolean {
  return Boolean(
    event.args?.agentOrgInboxTranscript === true ||
    event.result?.agentOrgInboxTranscript === true
  );
}

export const EMAIL_BUBBLE_TOOLS = [
  "org_send_message",
  "send_message",
  "send_to_inbox",
] as const;

export function isEmailBubbleEvent(event: SessionEvent): boolean {
  return (
    isAgentOrgInboxTranscriptEvent(event) ||
    (EMAIL_BUBBLE_TOOLS as readonly string[]).includes(event.functionName)
  );
}

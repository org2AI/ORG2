export interface AgentOrgExecution {
  turnIntentId: string;
  sourceKind:
    | "user_input"
    | "member_messages"
    | "task_dispatch"
    | "final_summary";
  participantId: string;
  participantName: string;
  inboxCount?: number;
  senders?: { memberId?: string | null; name?: string | null; count: number }[];
}

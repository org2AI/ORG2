import type { CliAgentType } from "@src/api/tauri/rpc/schemas/validation";
import {
  type ConversationRootLocator,
  NATIVE_CONVERSATION_CLI_TARGETS,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  type LocalConversationExecutionTargetSnapshot,
  conversationExecutionParentId,
} from "@src/engines/SessionCore/conversations/localConversationContinuation";
import type { AgentRegistry } from "@src/store/session/agentRegistryAtom";
import type { Session } from "@src/store/session/sessionAtom";

export interface ExecutionTargetHydration {
  rootKey: string;
  status: "loading" | "ready" | "error";
  targets: readonly LocalConversationExecutionTargetSnapshot[];
}

export function resolveNativeConversationCliTargets(
  agents: AgentRegistry["agents"],
  discoverySettled: boolean
): CliAgentType[] {
  if (!discoverySettled) return [];
  const supported = [...NATIVE_CONVERSATION_CLI_TARGETS] as CliAgentType[];
  // Continuations launch through the native shell-out adapters. GUI launch
  // capability is unrelated and would incorrectly hide a working ambient
  // Claude installation whose discovery row reports supportsGui=false.
  return supported.filter((runtime) =>
    agents.some((agent) => agent.name === runtime && agent.installed)
  );
}

/** Recover the target persisted by the newest native execution episode. */
export function latestConversationExecution(
  sessions: readonly Session[],
  root: ConversationRootLocator
): Session | undefined {
  return conversationExecutions(sessions, root)[0];
}

/** Native execution episodes for a canonical conversation, newest first. */
export function conversationExecutions(
  sessions: readonly Session[],
  root: ConversationRootLocator
): Session[] {
  const parentId = conversationExecutionParentId(root);
  return sessions
    .filter((candidate) => candidate.parentSessionId === parentId)
    .sort((left, right) =>
      (right.updated_at ?? "").localeCompare(left.updated_at ?? "")
    );
}

/** Merge the durable restart snapshot with newer in-memory Session updates. */
export function mergeConversationExecutionTargets(
  durable: readonly LocalConversationExecutionTargetSnapshot[],
  live: readonly LocalConversationExecutionTargetSnapshot[]
): LocalConversationExecutionTargetSnapshot[] {
  const bySessionId = new Map(
    durable.map((execution) => [execution.sessionId, execution] as const)
  );
  for (const execution of live) {
    const persisted = bySessionId.get(execution.sessionId);
    if (!persisted || execution.updatedAt > persisted.updatedAt) {
      bySessionId.set(execution.sessionId, execution);
    }
  }
  return [...bySessionId.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

/** Ignore stale roots and block fallback selection until hydration settles. */
export function resolveConversationExecutionTargetHydration(
  rootKey: string | null,
  hydration: ExecutionTargetHydration | null,
  live: readonly LocalConversationExecutionTargetSnapshot[]
): {
  loading: boolean;
  failed: boolean;
  targets: LocalConversationExecutionTargetSnapshot[];
} {
  if (!rootKey) {
    return { loading: false, failed: false, targets: [...live] };
  }
  const current = hydration?.rootKey === rootKey ? hydration : null;
  // A live Session row is already newer than (or equal to) the pending disk
  // snapshot, so it can render immediately while the restart authority fills
  // in older provider pairs in the background.
  const loading =
    live.length === 0 && (!current || current.status === "loading");
  const failed = current?.status === "error" && live.length === 0;
  return {
    loading,
    failed,
    targets: mergeConversationExecutionTargets(
      current?.status === "ready" ? current.targets : [],
      live
    ),
  };
}

/** Select the current native-session owner only after target hydration settles. */
export function resolveConversationAppOpenSessionId(params: {
  viewerSessionId: string | null | undefined;
  executionTargets: readonly LocalConversationExecutionTargetSnapshot[];
  loading: boolean;
  failed: boolean;
}): string | null {
  if (params.loading || params.failed) return null;
  return (
    params.executionTargets[0]?.sessionId ?? params.viewerSessionId ?? null
  );
}

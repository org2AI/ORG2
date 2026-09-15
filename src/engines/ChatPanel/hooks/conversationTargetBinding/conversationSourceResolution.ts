import { getImportedHistorySourceBySessionId } from "@src/api/tauri/externalHistory";
import {
  type ConversationRootLocator,
  type ConversationSource,
  type LocalConversationTarget,
  NATIVE_CONVERSATION_CLI_TARGETS,
  isLocalConversationTarget,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  localConversationRootForSession,
  parseConversationExecutionParentId,
} from "@src/engines/SessionCore/conversations/localConversationContinuation";
import type { Session } from "@src/store/session/sessionAtom";

/**
 * Project any imported provider history onto the same canonical conversation
 * picker used by local and Team Sessions.
 *
 * The source does not need to expose a provider-native `resume` command. Its
 * authoritative transcript is already readable through the imported-history
 * adapter, so the user can still materialize it into any supported target
 * runtime. A compatible source runtime is only used as the initial selection;
 * unsupported sources start at the ordinary "Select agent" state.
 */
export function conversationSourceFromImportedHistory(params: {
  sessionId: string | null | undefined;
  session?: Session;
}): ConversationSource | undefined {
  const externalSource = getImportedHistorySourceBySessionId(params.sessionId);
  if (!externalSource || !params.sessionId) return undefined;

  const sourceCliAgentType = externalSource.cliResume?.agentType;
  const compatibleSourceCliAgentType =
    sourceCliAgentType &&
    NATIVE_CONVERSATION_CLI_TARGETS.includes(
      sourceCliAgentType as (typeof NATIVE_CONVERSATION_CLI_TARGETS)[number]
    )
      ? sourceCliAgentType
      : undefined;
  const root = {
    authority: "imported-history",
    authorityScope: [externalSource.sourceId],
    conversationId: params.sessionId,
  } as const;

  return {
    root,
    cliAgentType: compatibleSourceCliAgentType,
    model: params.session?.model,
    initialTarget: null,
    workspaceRepoPath:
      params.session?.repoRootPath ??
      params.session?.worktreePath ??
      params.session?.repoPath ??
      null,
  };
}

/** Recover the provider/runtime target recorded by an existing native Session. */
export function localConversationTargetFromSession(
  session: Pick<
    Session,
    | "cliAgentType"
    | "agentDefinitionId"
    | "accountId"
    | "credentialSource"
    | "model"
    | "repoPath"
    | "worktreePath"
  >
): LocalConversationTarget | null {
  const workspaceRepoPath = session.worktreePath ?? session.repoPath ?? null;
  if (session.credentialSource !== undefined) {
    const target = {
      cliAgentType: session.cliAgentType,
      credentialSource: session.credentialSource,
      accountId: session.accountId,
      model: session.model,
      workspaceRepoPath,
    };
    return isLocalConversationTarget(target) ? target : null;
  }
  if (
    session.cliAgentType &&
    (session.accountId || session.cliAgentType === "claude_code")
  ) {
    return {
      cliAgentType: session.cliAgentType,
      accountId: session.accountId,
      model: session.model,
      workspaceRepoPath,
    };
  }
  if (session.agentDefinitionId && session.accountId && session.model) {
    return {
      agentDefinitionId: session.agentDefinitionId,
      accountId: session.accountId,
      model: session.model,
      workspaceRepoPath,
    };
  }
  return null;
}

/**
 * A writable episode owns its execution checkout. Its canonical root may be
 * an immutable imported row whose absolute source cwd is stale or belongs to
 * another machine, so it must never overwrite the episode on later turns.
 */
export function writableConversationWorkspacePath(
  episode: Session,
  root: Session
): string | null {
  return (
    episode.worktreePath ??
    episode.repoPath ??
    episode.repoRootPath ??
    root.repoRootPath ??
    root.worktreePath ??
    root.repoPath ??
    null
  );
}

/** A continuation child never becomes a new conversation authority. */
export function conversationRootForSession(
  session: Pick<
    Session,
    "session_id" | "parentSessionId" | "cliAgentType" | "agentDefinitionId"
  >
): ConversationRootLocator | null {
  return (
    parseConversationExecutionParentId(session.parentSessionId) ??
    localConversationRootForSession(
      session.session_id,
      session.cliAgentType,
      session.agentDefinitionId
    )
  );
}

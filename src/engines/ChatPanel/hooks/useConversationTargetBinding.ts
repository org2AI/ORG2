/** React binding from a canonical conversation to the standard creator controls. */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";

import { getImportedHistorySourceBySessionId } from "@src/api/tauri/externalHistory";
import type { CliAgentType } from "@src/api/tauri/rpc/schemas/validation";
import { isHostedKey } from "@src/api/tauri/session";
import {
  type ConversationTargetBinding,
  resolveConversationRuntimeSelection,
  resolveConversationRuntimeTarget,
  resolveConversationTargetPillPresentation,
  resolveConversationTargetReadiness,
  resolveDefaultConversationTarget,
  resolvePickedConversationRuntimeTarget,
} from "@src/engines/ChatPanel/conversationTargetSelection";
import {
  type ConversationRootLocator,
  type ConversationSource,
  type LocalConversationTarget,
  NATIVE_CONVERSATION_CLI_TARGETS,
  conversationRootKey,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  conversationExecutionParentId,
  localConversationRootForSession,
  parseConversationExecutionParentId,
} from "@src/engines/SessionCore/conversations/localConversationContinuation";
import { useCloudConversationSource } from "@src/features/Org2Cloud/SessionConversation/useCloudConversationSource";
import {
  sessionCommentTargetForConversationRoot,
  useSessionCommentTarget,
} from "@src/features/Org2Cloud/sessionCommentTarget";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import {
  getRustCompatibleAccounts,
  useAgentCompatibility,
} from "@src/hooks/models/useAgentCompatibility";
import { useModelAccountLookup } from "@src/hooks/models/useModelAccountLookup";
import { useAgentDefinitions } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentDefinitions";
import type { AgentSelection } from "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette";
import { reposAtom } from "@src/store/repo";
import type { Session } from "@src/store/session/sessionAtom";
import {
  sessionByIdAtom,
  sessionsAtom,
} from "@src/store/session/sessionAtom/atoms";
import {
  conversationTargetOverridesAtom,
  reconcileConversationTargetOverrideAtom,
  setConversationTargetOverrideAtom,
} from "@src/store/ui/conversationTargetAtom";

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

/** Recover the target persisted by the newest native execution episode. */
export function latestConversationExecution(
  sessions: readonly Session[],
  root: ConversationRootLocator
): Session | undefined {
  const parentId = conversationExecutionParentId(root);
  return sessions
    .filter((candidate) => candidate.parentSessionId === parentId)
    .sort((left, right) =>
      (right.updated_at ?? "").localeCompare(left.updated_at ?? "")
    )[0];
}

/** Recover the provider/runtime target recorded by an existing native Session. */
function localConversationTargetFromSession(
  session: Pick<
    Session,
    | "cliAgentType"
    | "agentDefinitionId"
    | "accountId"
    | "model"
    | "repoPath"
    | "worktreePath"
  >
): LocalConversationTarget | null {
  const workspaceRepoPath = session.worktreePath ?? session.repoPath ?? null;
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

export function useConversationTargetBinding(
  sessionId: string | null | undefined
): ConversationTargetBinding | null {
  // The remote transcript/progress surface can mount before its canonical
  // Session row commits. That is a hydration state, not a second source of
  // execution identity; roster loaders retain imported replay rows centrally.
  const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));
  const sessions = useAtomValue(sessionsAtom);
  const repos = useAtomValue(reposAtom);
  const { accounts, hasLoaded: accountsLoaded } = useModelAccountLookup();
  const { registry, discoveryState } = useAgentCompatibility();
  const { builtInAgents, agents: customAgents } = useAgentDefinitions();
  const definitions = useMemo(
    () => [...builtInAgents, ...customAgents],
    [builtInAgents, customAgents]
  );
  const externalSource = useMemo(
    () => conversationSourceFromImportedHistory({ sessionId, session }),
    [session, sessionId]
  );
  const commentTargetSession = useMemo(
    () =>
      session ??
      (externalSource && sessionId
        ? ({ session_id: sessionId } as Session)
        : null),
    [externalSource, session, sessionId]
  );
  const encodedCloudTarget = useMemo(
    () =>
      commentTargetSession
        ? sessionCommentTargetForConversationRoot(
            conversationRootForSession(commentTargetSession)
          )
        : null,
    [commentTargetSession]
  );
  const cloudTarget = useSessionCommentTarget(
    commentTargetSession,
    encodedCloudTarget
  );
  const cloudSource = useCloudConversationSource({
    sessionId,
    session,
    target: cloudTarget,
    sessions,
    repos,
  });
  const pickerOverrides = useAtomValue(conversationTargetOverridesAtom);
  const setPickerOverride = useSetAtom(setConversationTargetOverrideAtom);
  const reconcilePickerOverride = useSetAtom(
    reconcileConversationTargetOverrideAtom
  );

  const source = useMemo<ConversationSource | undefined>(() => {
    // Cloud sharing is the conversation authority from every viewpoint. An
    // owner row, an imported replay, and a native child must therefore choose
    // the same root before considering provider-local history provenance.
    if (cloudSource.source) {
      return cloudSource.source;
    }

    if (externalSource) return externalSource;

    if (!session) return undefined;

    const root = conversationRootForSession(session);
    if (!root) return undefined;
    const rootSession =
      sessions.find(
        (candidate) => candidate.session_id === root.conversationId
      ) ?? session;
    return {
      root,
      cliAgentType: session.cliAgentType ?? rootSession.cliAgentType,
      agentDefinitionId:
        session.agentDefinitionId ?? rootSession.agentDefinitionId,
      agentDisplayName:
        session.agentDisplayName ?? rootSession.agentDisplayName,
      model: session.model ?? rootSession.model,
      initialTarget: localConversationTargetFromSession(session),
      workspaceRepoPath: writableConversationWorkspacePath(
        session,
        rootSession
      ),
    };
  }, [cloudSource.source, externalSource, session, sessions]);

  const sourceRootKey = source ? conversationRootKey(source.root) : null;
  const persistedExecution = useMemo(
    () => (source ? latestConversationExecution(sessions, source.root) : null),
    [sessions, source]
  );
  const persistedTarget = useMemo(
    () =>
      persistedExecution
        ? localConversationTargetFromSession(persistedExecution)
        : null,
    [persistedExecution]
  );
  useEffect(() => {
    if (!sourceRootKey) return;
    reconcilePickerOverride({
      rootKey: sourceRootKey,
      persistedTarget,
    });
  }, [persistedTarget, reconcilePickerOverride, sourceRootKey]);
  const preferredTarget =
    (sourceRootKey ? pickerOverrides.get(sourceRootKey) : undefined) ??
    persistedTarget;

  const agentDiscoverySettled =
    discoveryState === "ready" ||
    discoveryState === "error" ||
    registry.agents.length > 0;
  // Background refreshes keep the last settled inventory usable. Only the
  // first hydration blocks target resolution.
  const inventoryLoading = !accountsLoaded || !agentDiscoverySettled;

  const nativeCliTargets = useMemo(() => {
    if (!agentDiscoverySettled) return [];
    const supported = [...NATIVE_CONVERSATION_CLI_TARGETS] as CliAgentType[];
    return supported.filter((runtime) =>
      registry.agents.some(
        (agent) =>
          agent.name === runtime && agent.installed && agent.supportsGui
      )
    );
  }, [agentDiscoverySettled, registry.agents]);

  const target = useMemo(() => {
    if (!source || inventoryLoading) return null;
    return resolveDefaultConversationTarget({
      preferredTarget,
      initialTarget: source.initialTarget,
      sourceCliAgentType: source.cliAgentType,
      sourceModel: source.model,
      workspaceRepoPath: cloudSource.workspacePending
        ? undefined
        : source.workspaceRepoPath,
      accounts,
      registry,
      nativeCliTargets,
    });
  }, [
    accounts,
    cloudSource.workspacePending,
    inventoryLoading,
    nativeCliTargets,
    preferredTarget,
    registry,
    source,
  ]);

  const hasAvailableRuntime = useMemo(
    () =>
      nativeCliTargets.length > 0 ||
      (definitions.length > 0 &&
        getRustCompatibleAccounts(registry, [...accounts]).some(
          (account) => account.enabled
        )),
    [accounts, definitions.length, nativeCliTargets.length, registry]
  );
  const readiness = resolveConversationTargetReadiness({
    accountsLoaded,
    agentDiscoverySettled,
    hasAvailableRuntime,
  });

  const presentation = useMemo(() => {
    if (!source || readiness !== "ready" || !target) return null;
    return resolveConversationTargetPillPresentation({
      target,
      accounts,
    });
  }, [accounts, readiness, source, target]);

  const runtimeSelection = useMemo(
    () =>
      source && readiness === "ready" && target
        ? resolveConversationRuntimeSelection({
            target,
            source,
            definitions,
          })
        : null,
    [definitions, readiness, source, target]
  );

  const applyModelPick = useCallback(
    (
      config: AdvancedConfig,
      pendingRuntime?: AgentSelection | null
    ): boolean => {
      if (readiness !== "ready" || isHostedKey(config.keySource) || !source) {
        return false;
      }
      const selectedRuntime = pendingRuntime ?? runtimeSelection;
      if (!selectedRuntime) return false;
      const nextTarget = resolvePickedConversationRuntimeTarget({
        selection: selectedRuntime,
        config: {
          ...config,
          cliAgentType: selectedRuntime.cliAgentType,
        },
        workspaceRepoPath:
          target?.workspaceRepoPath ?? source.workspaceRepoPath,
        accounts,
        registry,
        nativeCliTargets,
      });
      if (!nextTarget) return false;
      setPickerOverride({
        rootKey: conversationRootKey(source.root),
        target: nextTarget,
      });
      return true;
    },
    [
      accounts,
      nativeCliTargets,
      readiness,
      registry,
      runtimeSelection,
      setPickerOverride,
      source,
      target,
    ]
  );

  const applyRuntimePick = useCallback(
    (selection: AgentSelection): boolean => {
      if (readiness !== "ready" || !source) return false;
      const definition = selection.agentDefinitionId
        ? definitions.find(
            (candidate) => candidate.id === selection.agentDefinitionId
          )
        : undefined;
      const next = resolveConversationRuntimeTarget({
        selection,
        current: target,
        workspaceRepoPath:
          target?.workspaceRepoPath ?? source.workspaceRepoPath,
        preferredAccountId: definition?.selectedAccountId,
        preferredModel: definition?.selectedModelId,
        accounts,
        registry,
        nativeCliTargets,
      });
      if (!next) return false;
      setPickerOverride({
        rootKey: conversationRootKey(source.root),
        target: next,
      });
      return true;
    },
    [
      definitions,
      accounts,
      nativeCliTargets,
      readiness,
      registry,
      setPickerOverride,
      source,
      target,
    ]
  );

  return useMemo(
    () =>
      source
        ? {
            root: source.root,
            cloudTarget,
            selection: presentation?.selection ?? null,
            runtimeSelection,
            target,
            readiness,
            nativeCliTargets,
            applyRuntimePick,
            applyModelPick,
          }
        : null,
    [
      applyModelPick,
      applyRuntimePick,
      cloudTarget,
      nativeCliTargets,
      presentation,
      readiness,
      runtimeSelection,
      source,
      target,
    ]
  );
}

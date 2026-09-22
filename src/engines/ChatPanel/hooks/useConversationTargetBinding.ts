/** React binding from a canonical conversation to the standard creator controls. */
import { useAtomValue } from "jotai";
import { useMemo } from "react";

import {
  type ConversationTargetBinding,
  resolveConversationRuntimeSelection,
  resolveConversationTargetPillPresentation,
  resolveConversationTargetReadiness,
  resolveDefaultConversationTarget,
} from "@src/engines/ChatPanel/conversationTargetSelection";
import type { ConversationSource } from "@src/engines/SessionCore/conversations/conversationTypes";
import { useAgentCompatibility } from "@src/hooks/models/useAgentCompatibility";
import { useModelAccountLookup } from "@src/hooks/models/useModelAccountLookup";
import { useAgentDefinitions } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentDefinitions";
import {
  sessionByIdAtom,
  sessionsAtom,
} from "@src/store/session/sessionAtom/atoms";

import {
  conversationRootForSession,
  localConversationTargetFromSession,
  writableConversationWorkspacePath,
} from "./conversationTargetBinding/conversationSourceResolution";
import {
  resolveConversationAppOpenSessionId,
  resolveNativeConversationCliTargets,
} from "./conversationTargetBinding/executionTargetHydration";
import { useConversationCloudTarget } from "./conversationTargetBinding/useConversationCloudTarget";
import { useConversationExecutionTargets } from "./conversationTargetBinding/useConversationExecutionTargets";
import { useConversationTargetPicks } from "./conversationTargetBinding/useConversationTargetPicks";
import { useMarketTargetPresentation } from "./conversationTargetBinding/useMarketTargetPresentation";

export {
  conversationRootForSession,
  conversationSourceFromImportedHistory,
  writableConversationWorkspacePath,
} from "./conversationTargetBinding/conversationSourceResolution";
export type { ExecutionTargetHydration } from "./conversationTargetBinding/executionTargetHydration";
export {
  conversationExecutions,
  latestConversationExecution,
  mergeConversationExecutionTargets,
  resolveConversationAppOpenSessionId,
  resolveConversationExecutionTargetHydration,
  resolveNativeConversationCliTargets,
} from "./conversationTargetBinding/executionTargetHydration";

export function useConversationTargetBinding(
  sessionId: string | null | undefined
): ConversationTargetBinding | null {
  // The remote transcript/progress surface can mount before its canonical
  // Session row commits. That is a hydration state, not a second source of
  // execution identity; roster loaders retain imported replay rows centrally.
  const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));
  const sessions = useAtomValue(sessionsAtom);
  const { accounts, hasLoaded: accountsLoaded } = useModelAccountLookup();
  const { registry, discoveryState } = useAgentCompatibility();
  const { builtInAgents, agents: customAgents } = useAgentDefinitions();
  const definitions = useMemo(
    () => [...builtInAgents, ...customAgents],
    [builtInAgents, customAgents]
  );
  const { externalSource, cloudTarget, pendingCloudTarget, cloudSource } =
    useConversationCloudTarget({ sessionId, session, sessions });

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

  const {
    executionTargets,
    executionTargetHydrationLoading,
    executionTargetHydrationFailed,
    previousTargets,
    preferredTarget,
  } = useConversationExecutionTargets({ source, sessions });

  const agentDiscoverySettled =
    discoveryState === "ready" ||
    discoveryState === "error" ||
    registry.agents.length > 0;
  // Background refreshes keep the last settled inventory usable. Only the
  // first hydration blocks target resolution.
  const inventoryLoading = !accountsLoaded || !agentDiscoverySettled;

  const nativeCliTargets = useMemo(() => {
    return resolveNativeConversationCliTargets(
      registry.agents,
      agentDiscoverySettled
    );
  }, [agentDiscoverySettled, registry.agents]);

  const target = useMemo(() => {
    if (
      !source ||
      inventoryLoading ||
      executionTargetHydrationLoading ||
      executionTargetHydrationFailed
    ) {
      return null;
    }
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
    executionTargetHydrationFailed,
    executionTargetHydrationLoading,
    inventoryLoading,
    nativeCliTargets,
    preferredTarget,
    registry,
    source,
  ]);

  // Runtime availability allows the user to open its source picker. Account
  // credentials are selected separately; a Package-only SDE needs no KeyVault row.
  const hasAvailableRuntime =
    nativeCliTargets.length > 0 || definitions.length > 0;
  const resolvedReadiness = resolveConversationTargetReadiness({
    accountsLoaded,
    agentDiscoverySettled,
    hasAvailableRuntime,
  });
  const readiness =
    pendingCloudTarget || executionTargetHydrationLoading
      ? "loading"
      : executionTargetHydrationFailed
        ? "unavailable"
        : resolvedReadiness;

  const presentation = useMemo(() => {
    if (!source || readiness !== "ready" || !target) return null;
    return resolveConversationTargetPillPresentation({
      target,
      accounts,
    });
  }, [accounts, readiness, source, target]);

  const marketSelection = useMarketTargetPresentation(
    presentation?.selection ?? null
  );

  const runtimeSelection = useMemo(
    () =>
      source && readiness === "ready"
        ? resolveConversationRuntimeSelection({
            target: target ?? preferredTarget ?? source.initialTarget,
            source,
            definitions,
          })
        : null,
    [definitions, preferredTarget, readiness, source, target]
  );

  const { applyModelPick, applyRuntimePick } = useConversationTargetPicks({
    readiness,
    source,
    target,
    runtimeSelection,
    previousTargets,
    definitions,
    accounts,
    registry,
    nativeCliTargets,
  });

  return useMemo(
    () =>
      source
        ? {
            root: source.root,
            appOpenSessionId: resolveConversationAppOpenSessionId({
              viewerSessionId: sessionId,
              executionTargets,
              loading: executionTargetHydrationLoading,
              failed: executionTargetHydrationFailed,
            }),
            cloudTarget,
            selection: marketSelection,
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
      executionTargetHydrationFailed,
      executionTargetHydrationLoading,
      executionTargets,
      nativeCliTargets,
      marketSelection,
      readiness,
      runtimeSelection,
      sessionId,
      source,
      target,
    ]
  );
}

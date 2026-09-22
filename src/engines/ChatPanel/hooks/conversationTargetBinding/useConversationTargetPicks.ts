import { useSetAtom } from "jotai";
import { useCallback } from "react";

import type { CliAgentType } from "@src/api/tauri/rpc/schemas/validation";
import { isHostedKey } from "@src/api/tauri/session";
import {
  type ConversationTargetBinding,
  resolveConversationRuntimeTarget,
  resolvePickedConversationRuntimeTarget,
} from "@src/engines/ChatPanel/conversationTargetSelection";
import {
  type ConversationSource,
  type LocalConversationTarget,
  conversationRootKey,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import type { AgentSelection } from "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette";
import type { AgentRegistry } from "@src/store/session/agentRegistryAtom";
import { setConversationTargetOverrideAtom } from "@src/store/ui/conversationTargetAtom";

interface UseConversationTargetPicksArgs {
  readiness: ConversationTargetBinding["readiness"];
  source: ConversationSource | undefined;
  target: LocalConversationTarget | null;
  runtimeSelection: AgentSelection | null;
  previousTargets: LocalConversationTarget[];
  definitions: readonly AgentDefinition[];
  accounts: readonly KeyVaultAccount[];
  registry: AgentRegistry;
  nativeCliTargets: CliAgentType[];
}

/** Picker callbacks that record a model or runtime choice as a root override. */
export function useConversationTargetPicks({
  readiness,
  source,
  target,
  runtimeSelection,
  previousTargets,
  definitions,
  accounts,
  registry,
  nativeCliTargets,
}: UseConversationTargetPicksArgs) {
  const setPickerOverride = useSetAtom(setConversationTargetOverrideAtom);

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
        previousTargets,
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
      previousTargets,
      readiness,
      registry,
      setPickerOverride,
      source,
      target,
    ]
  );

  return { applyModelPick, applyRuntimePick };
}

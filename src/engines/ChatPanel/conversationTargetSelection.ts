import {
  type CliAgentType,
  CliAgentTypeSchema,
} from "@src/api/tauri/rpc/schemas/validation";
import { KEY_SOURCE } from "@src/api/tauri/session";
import { formatAgentType } from "@src/assets/providers";
import type {
  ConversationRootLocator,
  ConversationSource,
  LocalConversationTarget,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import {
  getCliCompatibleAccounts,
  getRustCompatibleAccounts,
} from "@src/hooks/models/useAgentCompatibility";
import {
  accountHasModel,
  accountModelIds,
} from "@src/hooks/models/useModelAccountLookup";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import type { AgentSelection } from "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette";
import type { AgentRegistry } from "@src/store/session/agentRegistryAtom";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";
import { SESSION_TARGET_KIND } from "@src/store/session/creatorStateAtom";

export interface ConversationTargetBinding {
  /** Stable typed identity shared by every native execution episode. */
  root: ConversationRootLocator;
  selection: LastModelSelection | null;
  runtimeSelection: AgentSelection | null;
  target: LocalConversationTarget | null;
  /** Whether runtime/account discovery can support an executable selection. */
  readiness: ConversationTargetReadiness;
  nativeCliTargets: readonly CliAgentType[];
  applyRuntimePick: (selection: AgentSelection) => boolean;
  applyModelPick: (config: AdvancedConfig) => boolean;
}

export type ConversationTargetReadiness = "loading" | "ready" | "unavailable";

export function resolveConversationTargetReadiness(params: {
  accountsLoaded: boolean;
  agentDiscoverySettled: boolean;
  hasAvailableRuntime: boolean;
}): ConversationTargetReadiness {
  if (!params.accountsLoaded || !params.agentDiscoverySettled) {
    return "loading";
  }
  return params.hasAvailableRuntime ? "ready" : "unavailable";
}

interface ConversationTargetPillPresentationInput {
  target: LocalConversationTarget | null;
  sourceCliAgentType?: string;
  sourceAgentDefinitionId?: string;
  sourceModel?: string;
  accounts?: readonly KeyVaultAccount[];
}

interface DefaultConversationTargetInput {
  /** Current picker override or latest persisted native execution target. */
  preferredTarget: LocalConversationTarget | null;
  initialTarget: LocalConversationTarget | null;
  sourceCliAgentType?: string;
  sourceAgentDefinitionId?: string;
  sourceModel?: string;
  /** Undefined while an imported conversation's local checkout is hydrating. */
  workspaceRepoPath: string | null | undefined;
  accounts: readonly KeyVaultAccount[];
  registry: AgentRegistry;
  nativeCliTargets: readonly CliAgentType[];
}

interface RuntimeConversationTargetInput {
  selection: AgentSelection;
  current: LocalConversationTarget | null;
  sourceModel?: string;
  workspaceRepoPath: string | null;
  preferredAccountId?: string;
  preferredModel?: string;
  accounts: readonly KeyVaultAccount[];
  registry: AgentRegistry;
  nativeCliTargets: readonly CliAgentType[];
}

function availableAccountModels(account: KeyVaultAccount): string[] {
  return accountModelIds(account).filter((model) =>
    accountHasModel(account, model)
  );
}

function chooseAccountAndModel(
  candidates: readonly KeyVaultAccount[],
  currentAccountId: string | undefined,
  currentModel: string | undefined,
  preferredAccountId: string | undefined,
  preferredModel: string | undefined
): { accountId: string; model: string } | null {
  const account =
    candidates.find((candidate) => candidate.id === currentAccountId) ??
    candidates.find((candidate) => candidate.id === preferredAccountId) ??
    (preferredModel
      ? candidates.find((candidate) =>
          accountHasModel(candidate, preferredModel)
        )
      : undefined) ??
    candidates[0];
  if (!account) return null;
  const model =
    (currentModel && accountHasModel(account, currentModel)
      ? currentModel
      : undefined) ??
    (preferredModel && accountHasModel(account, preferredModel)
      ? preferredModel
      : undefined) ??
    availableAccountModels(account)[0];
  return model ? { accountId: account.id, model } : null;
}

function isUsableTarget(
  target: LocalConversationTarget | null,
  accounts: readonly KeyVaultAccount[],
  registry: AgentRegistry,
  nativeCliTargets: readonly CliAgentType[]
): target is LocalConversationTarget {
  if (!target) return false;
  const parsedCliAgentType = CliAgentTypeSchema.safeParse(target.cliAgentType);
  if (parsedCliAgentType.success) {
    const cliAgentType = parsedCliAgentType.data;
    if (!nativeCliTargets.includes(cliAgentType)) return false;
    if (!target.accountId) return cliAgentType === "claude_code";
    const account = getCliCompatibleAccounts(registry, cliAgentType, [
      ...accounts,
    ]).find(
      (candidate) =>
        candidate.id === target.accountId &&
        candidate.enabled &&
        candidate.hasKey
    );
    return Boolean(
      account && target.model && accountHasModel(account, target.model)
    );
  }

  if (!target.agentDefinitionId || !target.accountId || !target.model) {
    return false;
  }
  const account = getRustCompatibleAccounts(registry, [...accounts]).find(
    (candidate) => candidate.id === target.accountId && candidate.enabled
  );
  return Boolean(account && accountHasModel(account, target.model));
}

function resolveCliTarget(params: {
  cliAgentType: CliAgentType;
  current: LocalConversationTarget | null;
  sourceModel?: string;
  workspaceRepoPath: string | null;
  accounts: readonly KeyVaultAccount[];
  registry: AgentRegistry;
}): LocalConversationTarget | null {
  const accounts = getCliCompatibleAccounts(
    params.registry,
    params.cliAgentType,
    [...params.accounts]
  ).filter((account) => account.enabled && account.hasKey);
  const sameRuntime = params.current?.cliAgentType === params.cliAgentType;
  const resolved = chooseAccountAndModel(
    accounts,
    sameRuntime ? params.current?.accountId : undefined,
    sameRuntime ? params.current?.model : undefined,
    undefined,
    params.sourceModel
  );
  if (!resolved) {
    if (params.cliAgentType !== "claude_code") return null;
    return {
      cliAgentType: params.cliAgentType,
      workspaceRepoPath: params.workspaceRepoPath,
      model: sameRuntime ? params.current?.model : undefined,
    };
  }
  return {
    cliAgentType: params.cliAgentType,
    ...resolved,
    workspaceRepoPath: params.workspaceRepoPath,
  };
}

function resolveAgentTarget(params: {
  agentDefinitionId: string;
  current: LocalConversationTarget | null;
  sourceModel?: string;
  workspaceRepoPath: string | null;
  preferredAccountId?: string;
  preferredModel?: string;
  accounts: readonly KeyVaultAccount[];
  registry: AgentRegistry;
}): LocalConversationTarget | null {
  const sameRuntime =
    params.current?.agentDefinitionId === params.agentDefinitionId;
  const resolved = chooseAccountAndModel(
    getRustCompatibleAccounts(params.registry, [...params.accounts]).filter(
      (account) => account.enabled && account.hasKey
    ),
    sameRuntime ? params.current?.accountId : undefined,
    sameRuntime ? params.current?.model : undefined,
    params.preferredAccountId,
    params.preferredModel ?? params.sourceModel
  );
  if (!resolved) return null;
  return {
    agentDefinitionId: params.agentDefinitionId,
    ...resolved,
    workspaceRepoPath: params.workspaceRepoPath,
  };
}

export function resolveDefaultConversationTarget({
  preferredTarget,
  initialTarget,
  sourceCliAgentType,
  sourceAgentDefinitionId,
  sourceModel,
  workspaceRepoPath,
  accounts,
  registry,
  nativeCliTargets,
}: DefaultConversationTargetInput): LocalConversationTarget | null {
  // Cold boot restores the canonical execution choice before the repository
  // inventory finishes hydrating. `undefined` means "not resolved yet", not
  // "run without a workspace": retain the last verified local path until the
  // shared repo-scope resolver returns a definitive path or null.
  const resolvedWorkspaceRepoPath =
    workspaceRepoPath === undefined
      ? (preferredTarget?.workspaceRepoPath ??
        initialTarget?.workspaceRepoPath ??
        null)
      : workspaceRepoPath;
  if (isUsableTarget(preferredTarget, accounts, registry, nativeCliTargets)) {
    return {
      ...preferredTarget,
      workspaceRepoPath: resolvedWorkspaceRepoPath,
    };
  }
  if (isUsableTarget(initialTarget, accounts, registry, nativeCliTargets)) {
    return {
      ...initialTarget,
      workspaceRepoPath: resolvedWorkspaceRepoPath,
    };
  }

  const parsedSource = CliAgentTypeSchema.safeParse(sourceCliAgentType);
  if (parsedSource.success && nativeCliTargets.includes(parsedSource.data)) {
    return resolveCliTarget({
      cliAgentType: parsedSource.data,
      current: null,
      sourceModel,
      workspaceRepoPath: resolvedWorkspaceRepoPath,
      accounts,
      registry,
    });
  }
  if (sourceAgentDefinitionId) {
    return resolveAgentTarget({
      agentDefinitionId: sourceAgentDefinitionId,
      current: null,
      sourceModel,
      workspaceRepoPath: resolvedWorkspaceRepoPath,
      accounts,
      registry,
    });
  }
  return null;
}

export function resolveConversationRuntimeTarget({
  selection,
  current,
  sourceModel,
  workspaceRepoPath,
  preferredAccountId,
  preferredModel,
  accounts,
  registry,
  nativeCliTargets,
}: RuntimeConversationTargetInput): LocalConversationTarget | null {
  let resolved: LocalConversationTarget | null = null;
  if (selection.category === "cli_agent" && selection.cliAgentType) {
    if (!nativeCliTargets.includes(selection.cliAgentType)) return null;
    // Picking the Claude Code runtime means "use the signed-in local CLI".
    // Managed Claude-compatible accounts (including Anthropic-compatible
    // gateways such as Atlas) remain explicit model/source choices in the
    // model picker; silently choosing the first one here makes a runtime-only
    // switch change credentials and endpoint behind the user's back.
    if (selection.cliAgentType === "claude_code") {
      return {
        cliAgentType: "claude_code",
        workspaceRepoPath,
      };
    }
    resolved = resolveCliTarget({
      cliAgentType: selection.cliAgentType,
      current,
      // A runtime pick is not a source/account pick. In particular, Claude
      // Code should auto-detect its signed-in CLI account and its default
      // model; carrying a Codex/source model into that runtime is invalid.
      sourceModel,
      workspaceRepoPath,
      accounts,
      registry,
    });
  } else if (
    selection.category === "rust_agent" &&
    selection.agentDefinitionId
  ) {
    resolved = resolveAgentTarget({
      agentDefinitionId: selection.agentDefinitionId,
      current,
      sourceModel,
      workspaceRepoPath,
      preferredAccountId,
      preferredModel,
      accounts,
      registry,
    });
  }
  return resolved;
}

export function resolveConversationTargetPillPresentation({
  target,
  accounts = [],
}: ConversationTargetPillPresentationInput): Pick<
  ConversationTargetBinding,
  "selection"
> {
  // Source provenance is not an execution selection. Until discovery has
  // produced a real target, both standard picker pills remain neutral.
  if (!target) return { selection: null };
  const selectedCliAgentType = target.cliAgentType;
  const parsedCliAgentType = CliAgentTypeSchema.safeParse(selectedCliAgentType);
  const cliAgentType = parsedCliAgentType.success
    ? parsedCliAgentType.data
    : undefined;
  // An accountless Claude Code target deliberately delegates model choice to
  // the signed-in local CLI. That is still a complete, sendable selection:
  // render the existing native `default` model option instead of the setup
  // placeholder. Keep the execution target model undefined so the runner
  // omits `--model` and Claude performs its normal auto-detection.
  const model =
    target.model ??
    (target.cliAgentType === "claude_code" && !target.accountId
      ? "default"
      : undefined);
  const selectedAccountId = target?.accountId;
  const selectedAccount = accounts.find(
    (account) => account.id === selectedAccountId
  );
  return {
    selection: {
      keySource: KEY_SOURCE.OWN,
      model,
      selectedAccountId,
      cliAgentType,
      selectedSourceLabel: selectedAccount?.name,
      selectedSourceModelType:
        selectedAccount?.modelType ?? (cliAgentType || undefined),
    },
  };
}

export function resolveConversationRuntimeSelection(params: {
  target: LocalConversationTarget | null;
  source: ConversationSource;
  definitions: readonly AgentDefinition[];
}): AgentSelection | null {
  if (!params.target) return null;
  const selectedCliAgentType = params.target.cliAgentType;
  const parsedCliAgentType = CliAgentTypeSchema.safeParse(selectedCliAgentType);
  if (parsedCliAgentType.success) {
    return {
      category: "cli_agent",
      targetKind: SESSION_TARGET_KIND.CLI_AGENT,
      cliAgentType: parsedCliAgentType.data,
      agentName: formatAgentType(parsedCliAgentType.data),
    };
  }
  const agentDefinitionId = params.target.agentDefinitionId;
  if (!agentDefinitionId) return null;
  const definition = params.definitions.find(
    (candidate) => candidate.id === agentDefinitionId
  );
  return {
    category: "rust_agent",
    targetKind: SESSION_TARGET_KIND.AGENT,
    agentDefinitionId,
    agentName:
      definition?.name ?? params.source.agentDisplayName ?? agentDefinitionId,
    agentIconId: definition?.iconId,
  };
}

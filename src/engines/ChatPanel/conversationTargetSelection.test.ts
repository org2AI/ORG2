import { describe, expect, it } from "vitest";

import type { KeyVaultAccount } from "@src/hooks/keyVault";
import type { AgentRegistry } from "@src/store/session/agentRegistryAtom";

import {
  resolveConversationRuntimeSelection,
  resolveConversationRuntimeTarget,
  resolveConversationTargetPillPresentation,
  resolveConversationTargetReadiness,
  resolveDefaultConversationTarget,
  resolvePickedConversationRuntimeTarget,
} from "./conversationTargetSelection";

function account(
  id: string,
  modelType: "claude_code" | "codex",
  model: string
): KeyVaultAccount {
  return {
    id,
    hasLocalKey: true,
    isListed: false,
    modelType,
    name: id,
    status: "ready",
    hasKey: true,
    hasApiKey: false,
    hasSessionToken: true,
    canLaunchCli: true,
    enabled: true,
    availableModels: [model],
    enabledModels: [model],
  };
}

const registry = {
  agents: [
    {
      name: "claude_code",
      compatibleApiProviders: ["anthropic_api"],
      supportsRustAgents: false,
    },
    {
      name: "codex",
      compatibleApiProviders: ["openai_compatible"],
      supportsRustAgents: true,
    },
  ],
  apiProviders: [],
} as unknown as AgentRegistry;

describe("canonical conversation target selection", () => {
  it("uses the selected Rust agent's existing preferred account and model", () => {
    expect(
      resolveConversationRuntimeTarget({
        selection: {
          category: "rust_agent",
          targetKind: "agent",
          agentDefinitionId: "builtin:sde",
          agentName: "SDE Agent",
        },
        current: null,
        workspaceRepoPath: "/repo",
        preferredAccountId: "rust-account",
        preferredModel: "gpt-5.6-sol",
        accounts: [account("rust-account", "codex", "gpt-5.6-sol")],
        registry,
        nativeCliTargets: ["claude_code", "codex"],
      })
    ).toEqual({
      agentDefinitionId: "builtin:sde",
      accountId: "rust-account",
      model: "gpt-5.6-sol",
      workspaceRepoPath: "/repo",
    });
  });

  it("keeps an explicit ORG2 runtime above a native CLI source", () => {
    const target = {
      agentDefinitionId: "builtin:sde",
      accountId: "rust-account",
      model: "gpt-5.6-sol",
      workspaceRepoPath: "/repo",
    };

    expect(
      resolveConversationRuntimeSelection({
        target,
        source: {
          root: {
            authority: "local-session",
            authorityScope: [],
            conversationId: "native-source",
          },
          cliAgentType: "claude_code",
          model: "claude-opus-5",
          initialTarget: null,
          workspaceRepoPath: "/repo",
        },
        definitions: [
          {
            id: "builtin:sde",
            name: "SDE Agent",
          } as never,
        ],
      })
    ).toMatchObject({
      category: "rust_agent",
      agentDefinitionId: "builtin:sde",
      agentName: "SDE Agent",
    });

    expect(
      resolveConversationTargetPillPresentation({
        target,
        accounts: [account("rust-account", "codex", "gpt-5.6-sol")],
      })
    ).toMatchObject({
      selection: {
        cliAgentType: undefined,
        model: "gpt-5.6-sol",
        selectedAccountId: "rust-account",
      },
    });
  });

  it("does not infer a Codex account from source model provenance", () => {
    expect(
      resolveDefaultConversationTarget({
        preferredTarget: null,
        initialTarget: null,
        sourceCliAgentType: "codex",
        sourceModel: "gpt-5.6-sol",
        workspaceRepoPath: "/repo",
        accounts: [
          account("codex-local", "codex", "gpt-5.6-sol"),
          account("claude-local", "claude_code", "claude-opus-5"),
        ],
        registry,
        nativeCliTargets: ["claude_code", "codex"],
      })
    ).toBeNull();
  });

  it("commits a pending Codex pick only after source and model are complete", () => {
    const selection = {
      category: "cli_agent",
      targetKind: "cli_agent",
      cliAgentType: "codex",
      agentName: "Codex",
    } as const;
    const input = {
      selection,
      workspaceRepoPath: "/repo",
      accounts: [account("openai-1", "codex", "gpt-5.6-sol")],
      registry,
      nativeCliTargets: ["claude_code", "codex"] as const,
    };
    expect(
      resolvePickedConversationRuntimeTarget({
        ...input,
        config: { keySource: "own_key", cliAgentType: "codex" },
      })
    ).toBeNull();
    expect(
      resolvePickedConversationRuntimeTarget({
        ...input,
        config: {
          keySource: "own_key",
          cliAgentType: "codex",
          selectedAccountId: "openai-1",
          model: "gpt-5.6-sol",
        },
      })
    ).toEqual({
      cliAgentType: "codex",
      accountId: "openai-1",
      model: "gpt-5.6-sol",
      workspaceRepoPath: "/repo",
    });
  });

  it("uses the signed-in local Claude CLI when no managed account exists", () => {
    expect(
      resolveDefaultConversationTarget({
        preferredTarget: null,
        initialTarget: null,
        sourceCliAgentType: "claude_code",
        sourceModel: undefined,
        workspaceRepoPath: "/repo",
        accounts: [],
        registry,
        nativeCliTargets: ["claude_code", "codex"],
      })
    ).toEqual({
      cliAgentType: "claude_code",
      model: undefined,
      workspaceRepoPath: "/repo",
    });
  });

  it("switches directly to native Claude Default and clears provider overrides", () => {
    const selection = {
      category: "cli_agent",
      targetKind: "cli_agent",
      cliAgentType: "claude_code",
      agentName: "Claude Code",
    } as const;

    expect(
      resolveConversationRuntimeTarget({
        selection,
        current: {
          cliAgentType: "codex",
          accountId: "openai-1",
          model: "gpt-5.6-sol",
          workspaceRepoPath: "/repo",
        },
        workspaceRepoPath: "/repo",
        accounts: [account("openai-1", "codex", "gpt-5.6-sol")],
        registry,
        nativeCliTargets: ["claude_code", "codex"],
      })
    ).toEqual({
      cliAgentType: "claude_code",
      workspaceRepoPath: "/repo",
    });

    expect(
      resolveConversationRuntimeTarget({
        selection,
        current: {
          cliAgentType: "claude_code",
          accountId: "atlas-1",
          model: "zai-org/glm-5.2",
          workspaceRepoPath: "/repo",
        },
        workspaceRepoPath: "/repo",
        accounts: [account("atlas-1", "claude_code", "zai-org/glm-5.2")],
        registry,
        nativeCliTargets: ["claude_code", "codex"],
      })
    ).toEqual({
      cliAgentType: "claude_code",
      workspaceRepoPath: "/repo",
    });
  });

  it("keeps an explicit composer provider switch", () => {
    expect(
      resolveDefaultConversationTarget({
        preferredTarget: {
          cliAgentType: "codex",
          accountId: "codex-local",
          model: "gpt-5.6-sol",
          workspaceRepoPath: "/repo",
        },
        initialTarget: null,
        sourceCliAgentType: "claude_code",
        sourceModel: "claude-opus-5",
        workspaceRepoPath: "/repo",
        accounts: [account("codex-local", "codex", "gpt-5.6-sol")],
        registry,
        nativeCliTargets: ["claude_code", "codex"],
      })
    ).toMatchObject({
      cliAgentType: "codex",
      model: "gpt-5.6-sol",
    });
  });

  it("retains the verified workspace while cold-start resolution is pending", () => {
    expect(
      resolveDefaultConversationTarget({
        preferredTarget: {
          cliAgentType: "claude_code",
          accountId: "claude-local",
          model: "claude-opus-5",
          workspaceRepoPath: "/local/checkout",
        },
        initialTarget: null,
        sourceCliAgentType: "claude_code",
        sourceModel: "claude-opus-5",
        workspaceRepoPath: undefined,
        accounts: [account("claude-local", "claude_code", "claude-opus-5")],
        registry,
        nativeCliTargets: ["claude_code", "codex"],
      })
    ).toEqual({
      cliAgentType: "claude_code",
      accountId: "claude-local",
      model: "claude-opus-5",
      workspaceRepoPath: "/local/checkout",
    });
  });

  it("does not present source provenance as a selected execution target", () => {
    expect(
      resolveConversationTargetPillPresentation({
        target: null,
      })
    ).toEqual({ selection: null });

    expect(
      resolveConversationRuntimeSelection({
        target: null,
        source: {
          root: {
            authority: "local-session",
            authorityScope: [],
            conversationId: "codex-source",
          },
          cliAgentType: "codex",
          model: "gpt-5.6-sol",
          initialTarget: null,
          workspaceRepoPath: "/repo",
        },
        definitions: [],
      })
    ).toBeNull();
  });

  it("keeps runtime controls neutral until both inventories settle", () => {
    expect(
      resolveConversationTargetReadiness({
        accountsLoaded: false,
        agentDiscoverySettled: true,
        hasAvailableRuntime: true,
      })
    ).toBe("loading");
    expect(
      resolveConversationTargetReadiness({
        accountsLoaded: true,
        agentDiscoverySettled: false,
        hasAvailableRuntime: true,
      })
    ).toBe("loading");
    expect(
      resolveConversationTargetReadiness({
        accountsLoaded: true,
        agentDiscoverySettled: true,
        hasAvailableRuntime: false,
      })
    ).toBe("unavailable");
    expect(
      resolveConversationTargetReadiness({
        accountsLoaded: true,
        agentDiscoverySettled: true,
        hasAvailableRuntime: true,
      })
    ).toBe("ready");
  });

  it("shows Claude's native Default model for an ambient runtime switch", () => {
    expect(
      resolveConversationTargetPillPresentation({
        target: {
          cliAgentType: "claude_code",
          workspaceRepoPath: "/repo",
        },
      })
    ).toEqual({
      selection: {
        keySource: "own_key",
        model: "default",
        selectedAccountId: undefined,
        cliAgentType: "claude_code",
        selectedSourceLabel: undefined,
        selectedSourceModelType: "claude_code",
      },
    });
  });
});

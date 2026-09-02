import { describe, expect, it } from "vitest";

import type { KeyVaultAccount } from "@src/hooks/keyVault";

import {
  resolveConversationRuntimeSelection,
  resolveConversationRuntimeTarget,
  resolveConversationTargetPillPresentation,
  resolveConversationTargetReadiness,
  resolveDefaultConversationTarget,
} from "./conversationTargetSelection";

function account(
  id: string,
  modelType: "claude_code" | "codex" | "cursor_cli",
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
    hasApiKey: modelType === "cursor_cli",
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
      compatibleApiProviders: [],
    },
    { name: "codex", compatibleApiProviders: [] },
    { name: "cursor_cli", compatibleApiProviders: [] },
  ],
  apiProviders: [],
} as never;

describe("canonical conversation target selection", () => {
  it("resolves a standard New Session runtime selection without a custom runtime list", () => {
    expect(
      resolveConversationRuntimeTarget({
        selection: {
          category: "cli_agent",
          targetKind: "cli_agent",
          cliAgentType: "codex",
          agentName: "Codex",
        },
        current: {
          workspaceRepoPath: "/repo",
          cliAgentType: "claude_code",
          model: "opus",
        },
        sourceModel: "claude-opus-5",
        workspaceRepoPath: "/repo",
        accounts: [account("codex-local", "codex", "gpt-5.6-sol")],
        registry,
        nativeCliTargets: ["claude_code", "codex"],
      })
    ).toEqual({
      cliAgentType: "codex",
      accountId: "codex-local",
      model: "gpt-5.6-sol",
      workspaceRepoPath: "/repo",
    });
  });

  it("switches to an installed Cursor CLI account without a setup dialog", () => {
    expect(
      resolveConversationRuntimeTarget({
        selection: {
          category: "cli_agent",
          targetKind: "cli_agent",
          cliAgentType: "cursor_cli",
          agentName: "Cursor CLI",
        },
        current: {
          cliAgentType: "codex",
          accountId: "codex-local",
          model: "gpt-5.6-sol",
          workspaceRepoPath: "/repo",
        },
        sourceModel: "gpt-5.6-sol",
        workspaceRepoPath: "/repo",
        accounts: [account("cursor-local", "cursor_cli", "composer-1")],
        registry,
        nativeCliTargets: ["claude_code", "codex", "cursor_cli"],
      })
    ).toEqual({
      cliAgentType: "cursor_cli",
      accountId: "cursor-local",
      model: "composer-1",
      workspaceRepoPath: "/repo",
    });
  });

  it("uses the selected Rust agent's existing preferred account and model", () => {
    const rustAccount = account("rust-account", "codex", "gpt-5.6-sol");
    expect(
      resolveConversationRuntimeTarget({
        selection: {
          category: "rust_agent",
          targetKind: "agent",
          agentDefinitionId: "builtin:sde",
          agentName: "SDE Agent",
        },
        current: null,
        sourceModel: "gpt-5.6-sol",
        workspaceRepoPath: "/repo",
        preferredAccountId: "rust-account",
        preferredModel: "gpt-5.6-sol",
        accounts: [rustAccount],
        registry: {
          agents: [
            {
              name: "claude_code",
              compatibleApiProviders: [],
            },
            {
              name: "codex",
              compatibleApiProviders: [],
              supportsRustAgents: true,
            },
          ],
          apiProviders: [],
        } as never,
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
          sourceTitle: "Native source",
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
        sourceCliAgentType: "claude_code",
        sourceModel: "claude-opus-5",
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

  it("resolves a same-provider target from healthy local accounts without a modal", () => {
    expect(
      resolveDefaultConversationTarget({
        preferredTarget: null,
        initialTarget: null,
        sourceCliAgentType: "claude_code",
        sourceModel: "claude-opus-5",
        workspaceRepoPath: "/repo",
        accounts: [
          account("codex-local", "codex", "gpt-5.6-sol"),
          account("claude-local", "claude_code", "claude-opus-5"),
        ],
        registry,
        nativeCliTargets: ["claude_code", "codex"],
      })
    ).toEqual({
      cliAgentType: "claude_code",
      accountId: "claude-local",
      model: "claude-opus-5",
      workspaceRepoPath: "/repo",
    });
  });

  it("uses the signed-in local Claude CLI for a runtime-only switch", () => {
    expect(
      resolveConversationRuntimeTarget({
        selection: {
          category: "cli_agent",
          targetKind: "cli_agent",
          cliAgentType: "claude_code",
          agentName: "Claude Code",
        },
        current: {
          cliAgentType: "codex",
          accountId: "codex-local",
          model: "gpt-5.6-sol",
          workspaceRepoPath: "/repo",
        },
        sourceModel: "gpt-5.6-sol",
        workspaceRepoPath: "/repo",
        accounts: [
          {
            ...account("stale-oauth", "claude_code", "claude-fable-5"),
            status: "error",
            healthStatus: "invalid",
          },
          account("healthy-claude", "claude_code", "claude-opus-5"),
        ],
        registry,
        nativeCliTargets: ["claude_code", "codex"],
      })
    ).toEqual({
      cliAgentType: "claude_code",
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

  it("ignores a stale remembered account and falls back without a dialog", () => {
    expect(
      resolveDefaultConversationTarget({
        preferredTarget: {
          cliAgentType: "claude_code",
          accountId: "deleted-account",
          model: "claude-opus-5",
          workspaceRepoPath: "/old-repo",
        },
        initialTarget: null,
        sourceCliAgentType: "claude_code",
        sourceModel: "claude-opus-5",
        workspaceRepoPath: "/repo",
        accounts: [account("claude-local", "claude_code", "claude-opus-5")],
        registry,
        nativeCliTargets: ["claude_code", "codex"],
      })
    ).toEqual({
      cliAgentType: "claude_code",
      accountId: "claude-local",
      model: "claude-opus-5",
      workspaceRepoPath: "/repo",
    });
  });

  it("does not present source provenance as a selected execution target", () => {
    expect(
      resolveConversationTargetPillPresentation({
        target: null,
        sourceCliAgentType: "codex",
        sourceModel: "gpt-5.6-sol",
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
          sourceTitle: "Codex source",
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

  it("shows the confirmed provider-native continuation target", () => {
    expect(
      resolveConversationTargetPillPresentation({
        target: {
          cliAgentType: "claude_code",
          accountId: "claude-local",
          model: "claude-opus-5",
          workspaceRepoPath: "/repo",
        },
        sourceCliAgentType: "codex",
        sourceModel: "gpt-5.6-sol",
      })
    ).toMatchObject({
      selection: {
        model: "claude-opus-5",
        selectedAccountId: "claude-local",
        cliAgentType: "claude_code",
      },
    });
  });

  it("shows Claude's native Default model for an ambient runtime switch", () => {
    expect(
      resolveConversationTargetPillPresentation({
        target: {
          cliAgentType: "claude_code",
          workspaceRepoPath: "/repo",
        },
        sourceCliAgentType: "codex",
        sourceModel: "gpt-5.5-medium",
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

  it("keeps a persisted local child account and provider visible", () => {
    expect(
      resolveConversationTargetPillPresentation({
        target: {
          cliAgentType: "codex",
          accountId: "openai-local",
          model: "gpt-5.5",
          workspaceRepoPath: "/repo",
        },
        sourceCliAgentType: "codex",
      })
    ).toMatchObject({
      selection: {
        model: "gpt-5.5",
        selectedAccountId: "openai-local",
        cliAgentType: "codex",
      },
    });
  });

  it("keeps a remembered ORG2 target above a Codex source", () => {
    expect(
      resolveConversationTargetPillPresentation({
        target: {
          agentDefinitionId: "builtin:sde",
          accountId: "openai",
          model: "gpt-5.6-luna",
          workspaceRepoPath: "/repo",
        },
        sourceCliAgentType: "codex",
        sourceModel: "gpt-5.6-sol",
      })
    ).toMatchObject({
      selection: {
        model: "gpt-5.6-luna",
        cliAgentType: undefined,
      },
    });
  });
});

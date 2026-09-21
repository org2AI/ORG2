import { describe, expect, it } from "vitest";

import {
  isConversationRootLocator,
  isLocalConversationTarget,
} from "./conversationTypes";

describe("isLocalConversationTarget", () => {
  it("accepts native CLI and ORG2 agent targets", () => {
    expect(
      isLocalConversationTarget({
        cliAgentType: "claude_code",
        accountId: "anthropic-1",
        model: "opus",
        workspaceRepoPath: "/repo",
      })
    ).toBe(true);
    expect(
      isLocalConversationTarget({
        agentDefinitionId: "agent-1",
        accountId: "account-1",
        model: "model-1",
      })
    ).toBe(true);
  });

  it("rejects malformed durable queue targets", () => {
    expect(isLocalConversationTarget({})).toBe(false);
    expect(isLocalConversationTarget({ cliAgentType: "" })).toBe(false);
    expect(
      isLocalConversationTarget({
        cliAgentType: "codex",
        agentDefinitionId: "agent-1",
      })
    ).toBe(false);
    expect(
      isLocalConversationTarget({
        agentDefinitionId: "agent-1",
        accountId: "account-1",
      })
    ).toBe(false);
    expect(
      isLocalConversationTarget({
        cliAgentType: "codex",
        workspaceRepoPath: 42,
      })
    ).toBe(false);
    expect(
      isLocalConversationTarget({
        cliAgentType: "claude_code",
        accountId: "",
      })
    ).toBe(false);
    expect(
      isLocalConversationTarget({
        cliAgentType: "codex",
        model: "",
      })
    ).toBe(false);
  });
});

describe("isConversationRootLocator", () => {
  it("rejects identities whose serialized form aliases another root", () => {
    expect(
      isConversationRootLocator({
        authority: "local-session",
        authorityScope: [],
        conversationId: "root-1",
      })
    ).toBe(true);
    expect(
      isConversationRootLocator({
        authority: " local-session ",
        authorityScope: [],
        conversationId: "root-1",
      })
    ).toBe(false);
    expect(
      isConversationRootLocator({
        authority: "org2-cloud",
        authorityScope: [" org-1"],
        conversationId: "root-1",
      })
    ).toBe(false);
  });
});

describe("dynamic execution targets", () => {
  it("round-trips a bounded source without a KeyVault account", () => {
    for (const cliAgentType of ["codex", "claude_code"]) {
      const target = {
        cliAgentType,
        credentialSource: "market:workspace",
        model: "model",
      };
      expect(
        isLocalConversationTarget(JSON.parse(JSON.stringify(target)))
      ).toBe(true);
      expect(
        isLocalConversationTarget({ ...target, accountId: "keyvault" })
      ).toBe(false);
      expect(
        isLocalConversationTarget({ ...target, agentDefinitionId: "native" })
      ).toBe(false);
      for (const credentialSource of ["", " ", "x".repeat(1025), 1, null]) {
        expect(isLocalConversationTarget({ ...target, credentialSource })).toBe(
          false
        );
      }
      expect(isLocalConversationTarget({ ...target, model: undefined })).toBe(
        false
      );
    }
  });
});

it("validates durable SDE Package targets with exclusive source ownership", () => {
  const target = {
    agentDefinitionId: "builtin:sde",
    credentialSource: "market:package",
    model: "gpt",
  };
  expect(isLocalConversationTarget(JSON.parse(JSON.stringify(target)))).toBe(
    true
  );
  for (const extra of [
    { accountId: "other" },
    { cliAgentType: "codex" },
    { model: " " },
    { credentialSource: "" },
    { credentialSource: " market:x" },
    { credentialSource: null },
  ]) {
    expect(isLocalConversationTarget({ ...target, ...extra })).toBe(false);
  }
});

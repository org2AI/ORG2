import { describe, expect, it } from "vitest";

import type { ConversationRootLocator } from "@src/engines/SessionCore/conversations/conversationTypes";

import { SubmitValidationError } from "../useInputArea/types";
import { canonicalConversationTargetOrThrow } from "./useConversationSubmitRouter";

const root: ConversationRootLocator = {
  authority: "imported-history",
  authorityScope: ["codex_app"],
  conversationId: "codexapp-session-1",
};

describe("canonicalConversationTargetOrThrow", () => {
  it("allows an ordinary session to use its existing direct dispatcher", () => {
    expect(canonicalConversationTargetOrThrow(null, null)).toBeNull();
  });

  it("never routes a canonical source through the legacy direct dispatcher", () => {
    expect(() => canonicalConversationTargetOrThrow(root, null)).toThrow(
      SubmitValidationError
    );
  });

  it("returns the selected canonical runtime", () => {
    const target = {
      cliAgentType: "codex",
      accountId: "openai",
      model: "gpt-test",
      workspaceRepoPath: "/repo",
    } as const;
    expect(canonicalConversationTargetOrThrow(root, target)).toBe(target);
  });
});

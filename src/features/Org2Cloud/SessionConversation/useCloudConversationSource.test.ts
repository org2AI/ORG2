import { describe, expect, it } from "vitest";

import { conversationSourceFromCloudReplay } from "./useCloudConversationSource";

describe("Cloud conversation source", () => {
  it("projects source runtime before the imported Session row exists", () => {
    expect(
      conversationSourceFromCloudReplay({
        orgId: "org-1",
        remoteSession: {
          id: "row-1",
          orgId: "org-1",
          ownerMemberId: "member-ada",
          ownerUserId: "user-ada",
          ownerDisplayName: "Ada Lovelace",
          ownerIdentityKind: "human",
          sourceSessionId: "claude-source",
          title: "Runtime migration",
          cliAgentType: "claude_code",
          model: "claude-opus-5",
          eventsEpoch: 1,
          eventsFrozenSeq: 8,
          eventsCount: 24,
          eventsTailHash: "tail",
        },
        workspaceRepoPath: null,
      })
    ).toEqual({
      root: {
        authority: "org2-cloud",
        authorityScope: ["org-1"],
        conversationId: "claude-source",
      },
      sourceTitle: "Runtime migration",
      cliAgentType: "claude_code",
      agentDefinitionId: undefined,
      agentDisplayName: undefined,
      model: "claude-opus-5",
      initialTarget: null,
      workspaceRepoPath: null,
    });
  });
});

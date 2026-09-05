import { describe, expect, it } from "vitest";

import {
  conversationRootForSession,
  conversationSourceFromImportedHistory,
  latestConversationExecution,
  resolveNativeConversationCliTargets,
  writableConversationWorkspacePath,
} from "./useConversationTargetBinding";

describe("conversation target binding source", () => {
  it("keeps an installed shell-out Claude runtime without GUI launch support", () => {
    expect(
      resolveNativeConversationCliTargets(
        [
          { name: "claude_code", installed: true, supportsGui: false },
          { name: "codex", installed: true, supportsGui: true },
        ] as never,
        true
      )
    ).toEqual(["claude_code", "codex"]);
  });

  it("projects a native imported history onto the canonical runtime picker", () => {
    expect(
      conversationSourceFromImportedHistory({
        sessionId: "claudecodeapp-session-1",
        session: {
          name: "Native Claude history",
          model: "claude-opus-5",
          repoPath: "/repo",
        } as never,
      })
    ).toMatchObject({
      cliAgentType: "claude_code",
      model: "claude-opus-5",
      workspaceRepoPath: "/repo",
      initialTarget: null,
    });
  });

  it("keeps an execution child's encoded Cloud root authoritative", () => {
    const root = {
      authority: "org2-cloud",
      authorityScope: ["org-1"],
      conversationId: "root-1",
    } as const;
    const parentSessionId = JSON.stringify([
      "org2-conversation",
      1,
      root.authority,
      root.authorityScope,
      root.conversationId,
    ]);

    expect(
      conversationRootForSession({
        session_id: "native-child",
        parentSessionId,
        cliAgentType: "codex",
      } as never)
    ).toEqual(root);
  });

  it("prefers the discovered local git root over a stale source worktree", () => {
    expect(
      conversationSourceFromImportedHistory({
        sessionId: "claudecodeapp-session-1",
        session: {
          name: "Native Claude history",
          repoPath: "/deleted/source-worktree",
          repoRootPath: "/local/repo-root",
        } as never,
      })
    ).toMatchObject({
      workspaceRepoPath: "/local/repo-root",
    });
  });

  it("keeps every imported provider eligible without native source resume", () => {
    expect(
      conversationSourceFromImportedHistory({
        sessionId: "windsurfapp-session-1",
      })
    ).toMatchObject({
      cliAgentType: undefined,
      workspaceRepoPath: null,
      initialTarget: null,
    });
  });

  it("keeps the writable episode checkout on later turns", () => {
    expect(
      writableConversationWorkspacePath(
        {
          repoPath: "/local/writable-episode",
        } as never,
        {
          repoPath: "/deleted/imported-worktree",
          repoRootPath: "/local/root-fallback",
        } as never
      )
    ).toBe("/local/writable-episode");
  });

  it("derives the remembered runtime from the newest persisted episode", () => {
    const root = {
      authority: "org2-cloud",
      authorityScope: ["org-1"],
      conversationId: "root-1",
    };
    const parentSessionId = JSON.stringify([
      "org2-conversation",
      1,
      root.authority,
      root.authorityScope,
      root.conversationId,
    ]);
    expect(
      latestConversationExecution(
        [
          {
            session_id: "older-codex",
            parentSessionId,
            updated_at: "2026-08-29T10:00:00Z",
          },
          {
            session_id: "newer-claude",
            parentSessionId,
            updated_at: "2026-08-29T11:00:00Z",
          },
          {
            session_id: "other-root",
            parentSessionId: "other",
            updated_at: "2026-08-29T12:00:00Z",
          },
        ] as never,
        root
      )?.session_id
    ).toBe("newer-claude");
  });
});

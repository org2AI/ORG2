import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { scopeConversationArtifacts } from "./localConversationArtifactScope";
import { projectNativeConversationItems } from "./nativeConversationProjection";

const mocks = vi.hoisted(() => ({ cli: vi.fn(), agent: vi.fn() }));
vi.mock("@src/api/tauri/rpc", () => ({ rpc: { cli: { status: mocks.cli } } }));
vi.mock("@src/api/tauri/agent", () => ({ getSession: mocks.agent }));

function answer(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: "answer",
    sessionId: "cliagent-sender",
    createdAt: "2026-09-24T00:00:00Z",
    source: "assistant",
    displayVariant: "message",
    displayStatus: "completed",
    functionName: "message",
    actionType: "assistant",
    displayText: "[Report](report.txt)",
    args: {},
    result: { content: "[Report](report.txt)" },
    ...overrides,
  } as SessionEvent;
}

beforeEach(() => vi.resetAllMocks());

describe("execution artifact scope", () => {
  it("uses the persisted worktree without requiring an account or model", async () => {
    mocks.cli.mockResolvedValue({
      repoPath: "/sender/repo",
      worktreePath: "/sender/worktree",
    });
    const original = answer();
    const scoped = await scopeConversationArtifacts("cliagent-sender", [
      original,
    ]);
    expect(scoped).toEqual([{ ...original, repoPath: "/sender/worktree" }]);
    expect(original.repoPath).toBeUndefined();
    expect(projectNativeConversationItems(scoped)).toEqual(
      projectNativeConversationItems([original])
    );
    expect(mocks.cli).toHaveBeenCalledExactlyOnceWith({
      sessionId: "cliagent-sender",
    });
  });

  it("uses the repository when no worktree exists", async () => {
    mocks.cli.mockResolvedValue({ repoPath: "/sender/repo" });
    expect(
      (await scopeConversationArtifacts("cliagent-sender", [answer()]))[0]
        ?.repoPath
    ).toBe("/sender/repo");
  });

  it("uses the persisted native agent workspace", async () => {
    mocks.agent.mockResolvedValue({ workspacePath: "/sender/agent" });
    expect(
      (await scopeConversationArtifacts("agentsession-sender", [answer()]))[0]
        ?.repoPath
    ).toBe("/sender/agent");
    expect(mocks.agent).toHaveBeenCalledExactlyOnceWith("agentsession-sender");
  });

  it("preserves explicit and inherited origins without reading another workspace", async () => {
    const events = [
      answer({ repoPath: "/original" }),
      answer({
        args: { __orgiiArtifactOrigin: { uploaderUserId: "original" } },
      }),
      answer({ args: { __orgiiSourceEventId: "orgii_evt_original" } }),
      answer({ args: { __orgiiMaterialized: true } }),
    ];
    expect(await scopeConversationArtifacts("cliagent-sender", events)).toBe(
      events
    );
    expect(mocks.cli).not.toHaveBeenCalled();
    expect(await scopeConversationArtifacts("cliagent-sender", [])).toEqual([]);
    expect(mocks.cli).not.toHaveBeenCalled();
  });

  it("keeps unknown historical scope unknown and propagates read failures for durable recovery", async () => {
    const events = [answer()];
    mocks.cli.mockResolvedValue(null);
    expect(await scopeConversationArtifacts("cliagent-sender", events)).toBe(
      events
    );
    mocks.cli.mockRejectedValue(new Error("database unavailable"));
    await expect(
      scopeConversationArtifacts("cliagent-sender", events)
    ).rejects.toThrow("database unavailable");
  });
});

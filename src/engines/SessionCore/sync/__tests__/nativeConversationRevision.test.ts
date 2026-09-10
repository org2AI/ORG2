import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadNativeConversationRevision } from "../nativeConversationRevision";

const mocks = vi.hoisted(() => ({ root: vi.fn(), children: vi.fn() }));
vi.mock("../adapters/cli/cliHistory", () => ({
  loadCliTranscriptRevision: mocks.root,
}));
vi.mock(
  "@src/engines/SessionCore/conversations/localConversationExecutionTail",
  () => ({ loadLocalExecutionChildrenRevision: mocks.children })
);
describe("managed conversation revision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.root.mockResolvedValue("root-stable");
    mocks.children.mockResolvedValue("[]");
  });
  it("retains the cheap root stamp without children", async () => {
    expect(await loadNativeConversationRevision("cliagent-root")).toBe(
      "root-stable"
    );
  });
  it("detects native App writes to a converted child while the root stays unchanged", async () => {
    mocks.children.mockResolvedValue("child-file-v1");
    const before = await loadNativeConversationRevision("cliagent-root");
    expect(await loadNativeConversationRevision("cliagent-root")).toBe(before);
    mocks.children.mockResolvedValue("child-file-v2");
    expect(await loadNativeConversationRevision("cliagent-root")).not.toBe(
      before
    );
    expect(mocks.children).toHaveBeenCalledWith({
      authority: "local-session",
      authorityScope: [],
      conversationId: "cliagent-root",
    });
  });
  it("defers an unavailable child without certifying the root alone", async () => {
    mocks.children.mockResolvedValue(null);
    expect(await loadNativeConversationRevision("cliagent-root")).toBeNull();
  });
  it.each([null, undefined])(
    "does not query children when root authority is %s",
    async (revision) => {
      mocks.root.mockResolvedValue(revision);
      expect(await loadNativeConversationRevision("cliagent-root")).toBe(
        revision
      );
      expect(mocks.children).not.toHaveBeenCalled();
    }
  );
});

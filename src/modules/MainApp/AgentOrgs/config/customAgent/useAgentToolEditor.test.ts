// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import {
  type AgentToolEditorState,
  useAgentToolEditor,
} from "./useAgentToolEditor";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  toolStates: vi.fn(),
  updatePatch: vi.fn(),
}));
vi.mock("@src/api/tauri/rpc", () => ({ rpc: { agentDef: mocks } }));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ error: vi.fn() }),
}));
let root: ReturnType<typeof createSmokeRoot>;
let editor: AgentToolEditorState;
const row = {
  name: "extra",
  enabled: true,
  systemPinned: false,
  capabilityBlocked: false,
  userAllowed: true,
  userExcluded: false,
};
function Probe({ id = "demo" }: { id?: string }) {
  const value = useAgentToolEditor(id);
  useEffect(() => {
    editor = value;
  }, [value]);
  return null;
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({
    id: "demo",
    tools: {
      systemRestrictToTools: [],
      userAllowedTools: ["extra"],
      excludedTools: [],
    },
  });
  mocks.toolStates.mockResolvedValue([row]);
  mocks.updatePatch.mockResolvedValue({});
  root = createSmokeRoot();
  await root.render(createElement(Probe));
});
afterEach(async () => {
  await root.unmount();
  vi.useRealTimers();
});
describe("atomic tool editing", () => {
  it("persists both deltas from the same OFF action and reads back the result", async () => {
    await act(async () => editor.setToolEnabled("extra", false));
    expect(editor.toolState("extra")).toBe("disabled");
    mocks.get.mockResolvedValue({
      id: "demo",
      tools: {
        systemRestrictToTools: [],
        userAllowedTools: [],
        excludedTools: ["extra"],
      },
    });
    mocks.toolStates.mockResolvedValue([
      { ...row, enabled: false, userAllowed: false, userExcluded: true },
    ]);
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(mocks.updatePatch).toHaveBeenCalledTimes(1);
    expect(mocks.updatePatch).toHaveBeenCalledWith({
      agentId: "demo",
      patch: { tools: { userAllowedTools: [], excludedTools: ["extra"] } },
    });
    expect(editor.userAllowedTools.has("extra")).toBe(false);
    expect(editor.toolState("extra")).toBe("disabled");
  });
  it("coalesces repeated changes into one final snapshot", async () => {
    await act(async () => {
      editor.setToolEnabled("extra", false);
      editor.setToolEnabled("extra", true);
    });
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(mocks.updatePatch).toHaveBeenCalledTimes(1);
    expect(mocks.updatePatch).toHaveBeenCalledWith({
      agentId: "demo",
      patch: { tools: { userAllowedTools: ["extra"], excludedTools: [] } },
    });
  });
  it("restores authoritative state after a rejected write and accepts retry", async () => {
    mocks.updatePatch.mockRejectedValueOnce(new Error("denied"));
    await act(async () => editor.setToolEnabled("extra", false));
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(editor.toolState("extra")).toBe("enabled");
    await act(async () => editor.setToolEnabled("extra", false));
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(mocks.updatePatch).toHaveBeenCalledTimes(2);
  });
  it("blocks capability-denied and pinned tools without writes", async () => {
    await root.unmount();
    mocks.toolStates.mockResolvedValue([
      { ...row, capabilityBlocked: true },
      { ...row, name: "pinned", systemPinned: true },
    ]);
    root = createSmokeRoot();
    await root.render(createElement(Probe));
    await act(async () => {
      editor.setToolEnabled("extra", true);
      editor.setToolEnabled("pinned", false);
    });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.updatePatch).not.toHaveBeenCalled();
    expect(editor.toolState("extra")).toBe("disabled");
  });
  it("flushes the old agent on switch without overwriting the new agent", async () => {
    await act(async () => editor.setToolEnabled("extra", false));
    mocks.get.mockImplementation(async ({ agentId }) => ({
      id: agentId,
      tools: {
        userAllowedTools: agentId === "new" ? ["new-tool"] : [],
        excludedTools: [],
      },
    }));
    mocks.toolStates.mockImplementation(async ({ agentId }) => [
      { ...row, name: agentId === "new" ? "new-tool" : "extra" },
    ]);
    await root.render(createElement(Probe, { id: "new" }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(mocks.updatePatch.mock.calls[0][0].agentId).toBe("demo");
    expect(editor.userAllowedTools.has("new-tool")).toBe(true);
    expect(editor.userAllowedTools.has("extra")).toBe(false);
  });
  it("exposes a failed initial read and recovers through retry", async () => {
    await root.unmount();
    mocks.get.mockRejectedValueOnce(new Error("offline"));
    root = createSmokeRoot();
    await root.render(createElement(Probe));
    expect(editor.loaded).toBe(false);
    expect(editor.error).toContain("offline");
    await act(async () => editor.retry());
    expect(editor.loaded).toBe(true);
    expect(editor.error).toBeNull();
  });
});

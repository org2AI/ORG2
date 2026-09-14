// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allAgentDefsAtom } from "@src/modules/MainApp/AgentOrgs/store/builtInAgentsAtom";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import {
  type UseAgentToolMatrixReturn,
  useAgentToolMatrix,
} from "./useAgentToolMatrix";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  toolStates: vi.fn(),
  updatePatch: vi.fn(),
}));
vi.mock("@src/api/tauri/rpc", () => ({ rpc: { agentDef: mocks } }));
vi.mock("@src/modules/MainApp/AgentOrgs/hooks/useEnsureAgentDefs", () => ({
  useEnsureAgentDefs: () => true,
}));
const agent: AgentDefinition = {
  id: "builtin:sde",
  name: "SDE",
  builtIn: true,
  tools: { userAllowedTools: ["read_file"], excludedTools: ["read_file"] },
};
const row = {
  name: "read_file",
  enabled: true,
  systemPinned: false,
  userAllowed: true,
  userExcluded: true,
  capabilityBlocked: false,
};
let root: ReturnType<typeof createSmokeRoot>,
  store: ReturnType<typeof createStore>,
  matrix: UseAgentToolMatrixReturn;
function Probe() {
  const value = useAgentToolMatrix();
  useEffect(() => {
    matrix = value;
  }, [value]);
  return null;
}
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(agent);
  mocks.toolStates.mockResolvedValue([row]);
  mocks.updatePatch.mockResolvedValue(agent);
  store = createStore();
  store.set(allAgentDefsAtom, [agent]);
  root = createSmokeRoot();
  await root.render(createElement(Provider, { store }, createElement(Probe)));
});
afterEach(async () => root.unmount());
describe("authoritative agent tool matrix", () => {
  it("uses backend availability even when excluded and allowed both contain the tool", () => {
    expect(matrix.loaded).toBe(true);
    expect(matrix.rowsByTool("read_file")[0]).toMatchObject({
      enabled: true,
      disabled: false,
    });
  });
  it("disables capability-blocked and unknown rows", async () => {
    mocks.toolStates.mockResolvedValue([
      { ...row, enabled: false, capabilityBlocked: true },
    ]);
    await act(async () => matrix.refresh());
    expect(matrix.rowsByTool("read_file")[0]).toMatchObject({
      enabled: false,
      disabled: true,
    });
    expect(matrix.rowsByTool("unknown")[0].disabled).toBe(true);
    await act(async () => matrix.toggle(agent.id, "read_file", true));
    expect(mocks.updatePatch).not.toHaveBeenCalled();
  });
  it("writes one delta patch and displays the backend readback", async () => {
    const saved = {
      ...agent,
      tools: { userAllowedTools: [], excludedTools: ["read_file"] },
    };
    mocks.updatePatch.mockResolvedValue(saved);
    mocks.toolStates.mockResolvedValue([{ ...row, enabled: false }]);
    await act(async () => matrix.toggle(agent.id, "read_file", false));
    expect(mocks.updatePatch).toHaveBeenCalledTimes(1);
    expect(mocks.updatePatch).toHaveBeenCalledWith({
      agentId: agent.id,
      patch: { tools: { userAllowedTools: [], excludedTools: ["read_file"] } },
    });
    expect(store.get(allAgentDefsAtom)).toEqual([saved]);
    expect(matrix.rowsByTool("read_file")[0].enabled).toBe(false);
  });
  it("preserves confirmed state on failure and permits retry", async () => {
    mocks.updatePatch.mockRejectedValueOnce(new Error("denied"));
    await act(async () => matrix.toggle(agent.id, "read_file", false));
    expect(matrix.error).toContain("denied");
    expect(matrix.rowsByTool("read_file")[0].enabled).toBe(true);
    await act(async () => matrix.toggle(agent.id, "read_file", false));
    expect(mocks.updatePatch).toHaveBeenCalledTimes(2);
  });
  it("rejects duplicate saves while one agent request is pending", async () => {
    let complete!: (value: AgentDefinition) => void;
    mocks.updatePatch.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = matrix.toggle(agent.id, "read_file", false);
      await matrix.toggle(agent.id, "read_file", false);
    });
    expect(mocks.updatePatch).toHaveBeenCalledTimes(1);
    expect(matrix.rowsByTool("read_file")[0].disabled).toBe(true);
    await act(async () => {
      complete(agent);
      await pending;
    });
  });
  it("does not refetch equivalent definitions", async () => {
    await act(async () => store.set(allAgentDefsAtom, [{ ...agent }]));
    expect(mocks.toolStates).toHaveBeenCalledTimes(1);
  });
  it("reuses an equivalent graph regardless of node and object property order", async () => {
    const parent: AgentDefinition = {
      ...agent,
      id: "builtin:base",
      capabilities: { coding: { modeSwitch: true } },
    };
    const child = { ...agent, inheritsFrom: parent.id };
    await act(async () => store.set(allAgentDefsAtom, [parent, child]));
    const calls = mocks.toolStates.mock.calls.length;
    const { tools, ...childRest } = child;
    const { capabilities, ...parentRest } = parent;
    await act(async () =>
      store.set(allAgentDefsAtom, [
        { tools, ...childRest },
        { capabilities, ...parentRest },
      ])
    );
    expect(mocks.toolStates).toHaveBeenCalledTimes(calls);
    expect(matrix.loaded).toBe(true);
  });
  it("reloads unchanged children when an internal parent's capabilities change", async () => {
    const parent: AgentDefinition = {
      ...agent,
      id: "builtin:base",
      capabilities: { coding: { modeSwitch: true } },
    };
    const child = { ...agent, inheritsFrom: parent.id };
    await act(async () => store.set(allAgentDefsAtom, [parent, child]));
    expect(matrix.agentCount).toBe(1);
    expect(matrix.rowsByTool("read_file")[0].enabled).toBe(true);
    mocks.toolStates.mockClear();
    mocks.toolStates.mockResolvedValue([
      { ...row, enabled: false, capabilityBlocked: true },
    ]);

    await act(async () =>
      store.set(allAgentDefsAtom, [{ ...parent, capabilities: {} }, child])
    );

    expect(store.get(allAgentDefsAtom)[1]).toBe(child);
    expect(mocks.toolStates).toHaveBeenCalledTimes(1);
    expect(mocks.toolStates).toHaveBeenCalledWith({ agentId: child.id });
    expect(matrix.rowsByTool("read_file")[0]).toMatchObject({
      enabled: false,
      disabled: true,
    });
  });
  it.each(["before", "after"])(
    "ignores stale child results completed %s the current graph",
    async (order) => {
      const parent = { ...agent, id: "builtin:base" };
      const child = { ...agent, inheritsFrom: parent.id };
      let completeOld!: () => void;
      let completeNew!: () => void;
      mocks.toolStates.mockImplementationOnce(
        () => new Promise((resolve) => (completeOld = () => resolve([row])))
      );
      await act(async () => store.set(allAgentDefsAtom, [parent, child]));
      expect(matrix.loaded).toBe(false);
      await act(async () =>
        store.set(allAgentDefsAtom, [{ ...child }, { ...parent }])
      );
      expect(mocks.toolStates).toHaveBeenCalledTimes(2);
      mocks.toolStates.mockImplementationOnce(
        () =>
          new Promise(
            (resolve) =>
              (completeNew = () => resolve([{ ...row, enabled: false }]))
          )
      );
      await act(async () =>
        store.set(allAgentDefsAtom, [
          { ...parent, tools: { excludedTools: ["read_file"] } },
          child,
        ])
      );
      expect(mocks.toolStates).toHaveBeenCalledTimes(3);

      if (order === "before") {
        await act(async () => completeOld());
        expect(matrix.loaded).toBe(false);
        expect(matrix.rowsByTool("read_file")[0].disabled).toBe(true);
      }

      await act(async () => completeNew());
      if (order === "after") await act(async () => completeOld());
      expect(matrix.loaded).toBe(true);
      expect(matrix.rowsByTool("read_file")[0]).toMatchObject({
        enabled: false,
        disabled: false,
      });
    }
  );
  it("surfaces load failure and retries without inventing availability", async () => {
    mocks.toolStates.mockRejectedValueOnce(new Error("offline"));
    await act(async () => matrix.refresh());
    expect(matrix.error).toContain("offline");
    expect(matrix.rowsByTool("read_file")[0].disabled).toBe(true);
    await act(async () => matrix.refresh());
    expect(matrix.error).toBeNull();
    expect(matrix.rowsByTool("read_file")[0].enabled).toBe(true);
  });
  it("bounds requests across a scope replacement and stops queued work on unmount", async () => {
    const completions: (() => void)[] = [];
    mocks.toolStates.mockImplementation(
      () =>
        new Promise((resolve) => {
          completions.push(() => resolve([row]));
        })
    );
    const batch = (prefix: string) =>
      Array.from({ length: 9 }, (_, index) => ({
        ...agent,
        id: `${prefix}:${index}`,
        builtIn: false,
      }));
    await act(async () => store.set(allAgentDefsAtom, batch("old")));
    expect(completions).toHaveLength(4);
    await act(async () => store.set(allAgentDefsAtom, batch("new")));
    expect(completions).toHaveLength(4);
    await act(async () => {
      completions.splice(0, 4).forEach((complete) => complete());
    });
    expect(completions).toHaveLength(4);
    expect(
      matrix
        .rowsByTool("read_file")
        .every((entry) => entry.agentId.startsWith("new:"))
    ).toBe(true);
    await root.unmount();
    const calls = mocks.toolStates.mock.calls.length;
    await act(async () => {
      completions.splice(0).forEach((complete) => complete());
    });
    expect(mocks.toolStates).toHaveBeenCalledTimes(calls);
  });
});

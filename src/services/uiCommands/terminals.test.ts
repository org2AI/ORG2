import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workstationActiveSessionIdAtom } from "@src/store/session/viewAtom";
import {
  activeTerminalIdAtom,
  terminalSessionsAtom,
} from "@src/store/workstation/codeEditor/terminal";
import { codeEditorTerminalTargetsAtom } from "@src/store/workstation/codeEditor/terminalTargetAtom";
import {
  selectWorkstationPanel,
  workstationTabsStateAtom,
} from "@src/store/workstation/tabs";

import fixture from "../../../src-tauri/crates/app-ui/protocol.fixture.json";
import type { UiRequest } from "./protocol";
import { createTerminalOperations } from "./terminals";

const mocks = vi.hoisted(() => ({
  store: null as unknown,
  invoke: vi.fn(),
  allowCreate: true,
}));
vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => mocks.store,
}));
vi.mock("@src/util/platform/tauri/init", () => ({
  invokeTauri: mocks.invoke,
  isTauriReady: () => true,
}));
vi.mock("@src/util/ui/terminal/creationThrottle", () => ({
  tryBeginTerminalCreation: () => mocks.allowCreate,
  notifyTerminalCreationCooldown: vi.fn(),
}));
let store: ReturnType<typeof createStore>;
const req = (command: string): UiRequest => ({
  ...(fixture as UiRequest),
  command,
  params: { terminalId: "one" },
});
beforeEach(() => {
  store = createStore();
  mocks.store = store;
  mocks.allowCreate = true;
  mocks.invoke.mockReset().mockResolvedValue({ output: "redacted output" });
  store.set(workstationActiveSessionIdAtom, "A");
  store.set(terminalSessionsAtom, [
    { id: "one", name: "Shell One", isActive: true },
    { id: "two", name: "Shell Two", isActive: false },
    { id: "agent-pty-agent", name: "Private Agent", isActive: false },
    { id: "chatpanel-cli", name: "Chat CLI", isActive: false },
    { id: "readonly", name: "Agent output", readOnly: true, isActive: false },
  ]);
  store.set(activeTerminalIdAtom, "one");
});
describe("public terminal resource adapter", () => {
  it("paginates eligible shared resources without exposing agent terminal metadata", () => {
    const operations = createTerminalOperations("g", req("ui.terminal.list"));
    expect(operations.list({ kind: "global" }, 1, 0)).toMatchObject({
      resourceScope: "instance",
      nextCursor: 1,
      terminals: [{ terminalId: "one" }],
    });
    expect(
      operations
        .list({ kind: "global" }, 100, 0)
        .terminals.map((t) => t.terminalId)
    ).toEqual(["one", "two"]);
  });
  it("writes only the captured workspace selection while reusing one Terminal tab", () => {
    const operations = createTerminalOperations("g", req("ui.terminal.focus"));
    const workspace = { kind: "session", sessionId: "B" } as const;
    operations.open("focus", workspace, { terminalId: "two" });
    operations.open("open", workspace, {});
    expect(store.get(codeEditorTerminalTargetsAtom)["session:B"]).toEqual({
      kind: "pty",
      ptySessionId: "two",
    });
    expect(
      store.get(codeEditorTerminalTargetsAtom)["session:A"]
    ).toBeUndefined();
    expect(store.get(activeTerminalIdAtom)).toBe("one");
    expect(
      selectWorkstationPanel(
        store.get(workstationTabsStateAtom),
        workspace
      ).tabs.filter((t) => t.type === "terminal")
    ).toHaveLength(1);
  });
  it("creates using the target repo only in the presented workspace and respects cooldown", () => {
    const operations = createTerminalOperations("g", req("ui.terminal.new"));
    expect(() =>
      operations.open("new", { kind: "global" }, {}, "/wrong")
    ).toThrow("TARGET_NOT_PRESENTABLE");
    const result = operations.open(
      "new",
      { kind: "session", sessionId: "A" },
      { name: "Build" },
      "/repo/A"
    );
    expect(result.created).toBe(true);
    expect(
      store.get(terminalSessionsAtom).find((s) => s.id === result.terminalId)
        ?.cwd
    ).toBe("/repo/A");
    mocks.allowCreate = false;
    expect(() =>
      operations.open("new", { kind: "session", sessionId: "A" }, {})
    ).toThrow("BUSY");
  });
  it("rejects unknown/agent IDs before I/O and rejects a resource removed during output read", async () => {
    const request = req("ui.terminal.read");
    request.params.terminalId = "agent-pty-agent";
    await expect(createTerminalOperations("g", request).io()).rejects.toThrow(
      "TERMINAL_NOT_FOUND"
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockImplementation(async () => {
      store.set(terminalSessionsAtom, []);
      return { output: "old output" };
    });
    await expect(
      createTerminalOperations("g", req("ui.terminal.read")).io()
    ).rejects.toThrow("TERMINAL_NOT_FOUND");
  });
  it("forwards the exact request rather than inferring the active terminal", async () => {
    const request = req("ui.terminal.execute");
    request.params = { terminalId: "two", command: "echo test" };
    await createTerminalOperations("generation", request).io();
    expect(mocks.invoke).toHaveBeenCalledWith("ui_terminal_io", {
      generation: "generation",
      request,
    });
    expect(store.get(activeTerminalIdAtom)).toBe("one");
  });
});

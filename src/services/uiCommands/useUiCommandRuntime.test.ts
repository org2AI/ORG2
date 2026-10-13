// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BrowserProvider } from "@src/contexts/workstation/BrowserContext";

import fixture from "../../../src-tauri/crates/app-ui/protocol.fixture.json";
import type { UiDependencies } from "./execute";
import { useUiCommandRuntime } from "./useUiCommandRuntime";

const mocks = vi.hoisted(() => ({
  label: "main",
  invoke: vi.fn(),
  prepare: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage = () => {};
  },
}));
vi.mock("@src/util/platform/tauri/windowIdentity", () => ({
  getCurrentWindowLabel: () => mocks.label,
  isStationWindow: () => mocks.label.startsWith("app-window-station-"),
}));
vi.mock("@src/util/platform/tauri/init", () => ({ invokeTauri: mocks.invoke }));
vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => ({
    get: () => ({ kind: "global" }),
    set: vi.fn(),
  }),
}));
vi.mock("./dependencies", () => ({
  createUiDependencies: (
    _generation: string,
    _request: unknown,
    openWeb: UiDependencies["openWeb"]
  ) => ({
    permitted: () => true,
    active: async () => true,
    resolveWorkspace: () => ({ repoPath: "/repo" }),
    prepareFile: mocks.prepare,
    tabs: () => [],
    partition: () => "workspace",
    openFile: mocks.open,
    openWeb,
    reveal: () => false,
  }),
}));
let channel: { onmessage: (value: unknown) => void };
let root: ReturnType<typeof createRoot>;
function Runtime() {
  useUiCommandRuntime();
  return null;
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.label = "main";
  mocks.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "ui_runtime_register") {
      channel = args.channel;
      return "generation";
    }
    return true;
  });
  mocks.prepare.mockReset().mockResolvedValue("/repo/file.ts");
  mocks.open.mockReset().mockReturnValue({
    id: "file:/repo/file.ts",
    title: "file.ts",
    type: "file",
    data: { filePath: "/repo/file.ts" },
  });
  root = createRoot(document.createElement("div"));
});
it("reuses a Browser resource for distinct requests before React commits", async () => {
  await act(async () =>
    root.render(createElement(BrowserProvider, null, createElement(Runtime)))
  );
  const request = {
    ...fixture,
    command: "ui.web.open",
    reveal: false,
    target: { ...fixture.target, workspace: { kind: "global" } },
    params: { url: "https://example.com" },
  };
  await act(async () => {
    channel.onmessage({
      generation: "generation",
      request: { ...request, requestId: "web-one" },
    });
    channel.onmessage({
      generation: "generation",
      request: { ...request, requestId: "web-two" },
    });
    await settle();
  });
  const stored = JSON.parse(localStorage.getItem("browser-explorer-sessions")!);
  expect(stored.sessions).toHaveLength(1);
  const receipts = mocks.invoke.mock.calls.filter(
    ([command]) => command === "ui_command_result"
  );
  expect(receipts).toHaveLength(2);
  expect(receipts[0][1].response.result.created).toBe(true);
  expect(receipts[1][1].response.result.created).toBe(false);
  expect(receipts[1][1].response.result.tab).toEqual(
    receipts[0][1].response.result.tab
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("registers under BrowserProvider and unregisters the same runtime generation", async () => {
  await act(async () =>
    root.render(createElement(BrowserProvider, null, createElement(Runtime)))
  );
  await act(async () => {
    channel.onmessage({ generation: "generation", request: fixture });
    await settle();
  });
  expect(mocks.open).toHaveBeenCalledOnce();
  expect(mocks.invoke).toHaveBeenCalledWith(
    "ui_command_result",
    expect.objectContaining({
      generation: "generation",
      response: expect.objectContaining({ status: "applied" }),
    })
  );
  await act(async () => root.unmount());
  expect(mocks.invoke).toHaveBeenCalledWith("ui_runtime_unregister", {
    generation: "generation",
  });
});
it("does not write after unmount while file preparation is in flight", async () => {
  let finish!: (path: string) => void;
  mocks.prepare.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  await act(async () =>
    root.render(createElement(BrowserProvider, null, createElement(Runtime)))
  );
  await act(async () => {
    channel.onmessage({ generation: "generation", request: fixture });
    await settle();
  });
  expect(mocks.prepare).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  finish("/repo/file.ts");
  await settle();
  expect(mocks.open).not.toHaveBeenCalled();
});
it("never registers a detached window as the main runtime", async () => {
  mocks.label = "station-secondary";
  await act(async () =>
    root.render(createElement(BrowserProvider, null, createElement(Runtime)))
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("unregisters a registration that finishes after unmount", async () => {
  let finish!: (generation: string) => void;
  mocks.invoke.mockImplementation((command) =>
    command === "ui_runtime_register"
      ? new Promise<string>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(true)
  );
  await act(async () =>
    root.render(createElement(BrowserProvider, null, createElement(Runtime)))
  );
  await act(async () => root.unmount());
  finish("late-generation");
  await settle();
  expect(mocks.invoke).toHaveBeenCalledWith("ui_runtime_unregister", {
    generation: "late-generation",
  });
});

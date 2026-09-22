import { createStore } from "jotai";
import { beforeEach, expect, it, vi } from "vitest";

import {
  createChatPanelTerminalAtom,
  destroyChatPanelTerminalAtom,
  terminalSessionsAtom,
} from "../chatPanelTerminalAtom";

const api = vi.hoisted(() => ({
  close: vi.fn(),
  release: vi.fn(),
  ready: vi.fn(),
}));
vi.mock("@src/api/tauri/agent/cliTerminalSession", () => ({
  cliAgentTuiRelease: api.release,
}));
vi.mock("@src/util/platform/tauri/init", () => ({
  invokeTauri: api.close,
  isTauriReady: api.ready,
}));
vi.mock(
  "@src/engines/TerminalCore/components/TerminalInteractive/bufferCache",
  () => ({ clearTerminalBufferCache: vi.fn() })
);
vi.mock("@src/store/workstation/codeEditor/terminal", async () => {
  const { atom } = await import("jotai");
  return {
    terminalSessionsAtom: atom([]),
    initializedTerminalIdsAtom: atom(new Set()),
    terminalPersistAtom: atom(null, () => {}),
    markTerminalInitializedAtom: atom(null, () => {}),
    updateTerminalSessionInfoAtom: atom(null, () => {}),
  };
});
beforeEach(() => {
  vi.resetAllMocks();
  api.ready.mockReturnValue(true);
});
function fixture() {
  const store = createStore();
  const id = store.set(createChatPanelTerminalAtom, {
    name: "Codex",
    agentCommand: "codex",
    agentSessionId: "cli_fixture",
    envOverride: { CODEX_HOME: "/private/profile", ORGII_SESSION_ID: "wrong" },
  });
  expect(store.get(terminalSessionsAtom)[0].envOverride).toEqual({
    CODEX_HOME: "/private/profile",
    ORGII_SESSION_ID: "cli_fixture",
  });
  return { store, id };
}
it("keeps the client profile until native process close has completed", async () => {
  let finish!: () => void;
  api.close.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  const { store, id } = fixture();
  const pending = store.set(destroyChatPanelTerminalAtom, id);
  expect(api.close).toHaveBeenCalledOnce();
  expect(api.release).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(api.release).toHaveBeenCalledWith("cli_fixture");
  expect(store.get(terminalSessionsAtom)).toHaveLength(0);
});
it("retains native configuration when close fails instead of assuming the process stopped", async () => {
  api.close.mockRejectedValue(new Error("IPC unavailable"));
  const { store, id } = fixture();
  await store.set(destroyChatPanelTerminalAtom, id);
  expect(api.release).not.toHaveBeenCalled();
});
it("does not release configuration when the native host is unavailable", async () => {
  api.ready.mockReturnValue(false);
  const { store, id } = fixture();
  await store.set(destroyChatPanelTerminalAtom, id);
  expect(api.close).not.toHaveBeenCalled();
  expect(api.release).not.toHaveBeenCalled();
});

import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerTerminalEventHandlers } from "../terminalHandlers";

const transport = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve()),
}));
vi.mock("@src/util/platform/tauri/init", () => ({
  invokeTauri: transport.invoke,
  isTauriReady: () => true,
}));
vi.mock("@src/util/platform/tauri", () => ({ isMacOS: () => false }));
vi.mock("@src/util/dom/uiScale", () => ({ getUiScaleFromCssVar: () => 1 }));
vi.mock("../terminalPty", () => ({ notifyPtyUserInput: vi.fn() }));
vi.mock("../bufferCache", () => ({ setTerminalBuffer: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe("terminal resize forwarding", () => {
  it("sends the fitted grid immediately and stops forwarding after cleanup", () => {
    const terminal = new Terminal({ cols: 64, rows: 24 });
    const cleanup = registerTerminalEventHandlers({
      terminal,
      serializeAddonRef: { current: null },
      sessionIdRef: { current: "terminal-pty-resize" },
      containerRef: { current: null },
      repoPathRef: { current: undefined },
      workingDirectoryRef: { current: undefined },
      onOpenFileLinkRef: { current: undefined },
    });
    try {
      terminal.resize(62, 20);
      // No timer advance: delaying until after xterm resizes is the bug.
      expect(transport.invoke).toHaveBeenCalledExactlyOnceWith("resize_pty", {
        request: { session_id: "terminal-pty-resize", cols: 62, rows: 20 },
      });
      terminal.resize(62, 20);
      expect(transport.invoke).toHaveBeenCalledTimes(1);
      cleanup();
      terminal.resize(60, 18);
      expect(transport.invoke).toHaveBeenCalledTimes(1);
    } finally {
      terminal.dispose();
    }
  });
});

/**
 * Tests for ShellIntegrationAddon OSC 633 sequence parsing.
 *
 * These tests verify that the addon correctly parses OSC 633 sequences
 * and invokes the appropriate callbacks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShellIntegrationAddon, type ShellIntegrationCallbacks } from "./index";

// Mock terminal with OSC handler registration
function createMockTerminal() {
  const oscHandlers = new Set<(data: string) => boolean>();

  return {
    parser: {
      registerOscHandler: vi.fn(
        (code: number, handler: (data: string) => boolean) => {
          if (code === 633) {
            oscHandlers.add(handler);
          }
          return { dispose: vi.fn(() => oscHandlers.delete(handler)) };
        }
      ),
    },
    // Helper to simulate receiving an OSC sequence
    receiveOsc633: (data: string) => {
      for (const handler of oscHandlers) {
        handler(data);
      }
    },
    get activeHandlerCount() {
      return oscHandlers.size;
    },
  };
}

describe("ShellIntegrationAddon", () => {
  let callbacks: ShellIntegrationCallbacks;
  let addon: ShellIntegrationAddon;
  let mockTerminal: ReturnType<typeof createMockTerminal>;

  beforeEach(() => {
    callbacks = {
      onPromptStart: vi.fn(),
      onCommandStart: vi.fn(),
      onCommandExecuted: vi.fn(),
      onCommandFinished: vi.fn(),
      onCwdChanged: vi.fn(),
    };
    addon = new ShellIntegrationAddon(callbacks);
    mockTerminal = createMockTerminal();

    // Activate the addon
    addon.activate(
      mockTerminal as unknown as Parameters<typeof addon.activate>[0]
    );
  });

  describe("activation", () => {
    it("registers OSC 633 handler on activation", () => {
      expect(mockTerminal.parser.registerOscHandler).toHaveBeenCalledWith(
        633,
        expect.any(Function)
      );
    });

    it("tracks activation state", () => {
      expect(addon.isActivated).toBe(false);

      // After receiving any sequence, addon is marked as activated
      mockTerminal.receiveOsc633("A");
      expect(addon.isActivated).toBe(true);
    });

    it("starts in idle phase", () => {
      expect(addon.currentPhase).toBe("idle");
    });
  });

  describe("OSC 633;A - Prompt Start", () => {
    it("calls onPromptStart callback", () => {
      mockTerminal.receiveOsc633("A");

      expect(callbacks.onPromptStart).toHaveBeenCalledTimes(1);
    });

    it("transitions to prompt phase", () => {
      mockTerminal.receiveOsc633("A");

      expect(addon.currentPhase).toBe("prompt");
    });

    it("clears pending command line", () => {
      // Set pending command first
      mockTerminal.receiveOsc633("E;ls -la");
      mockTerminal.receiveOsc633("A");

      // Now execute - should have no pending command
      mockTerminal.receiveOsc633("C");
      expect(callbacks.onCommandExecuted).toHaveBeenCalledWith(undefined);
    });
  });

  describe("OSC 633;B - Command Input Start", () => {
    it("calls onCommandStart callback", () => {
      mockTerminal.receiveOsc633("B");

      expect(callbacks.onCommandStart).toHaveBeenCalledTimes(1);
    });

    it("transitions to input phase", () => {
      mockTerminal.receiveOsc633("B");

      expect(addon.currentPhase).toBe("input");
    });
  });

  describe("OSC 633;C - Command Executed", () => {
    it("calls onCommandExecuted callback", () => {
      mockTerminal.receiveOsc633("C");

      expect(callbacks.onCommandExecuted).toHaveBeenCalledTimes(1);
    });

    it("transitions to running phase", () => {
      mockTerminal.receiveOsc633("C");

      expect(addon.currentPhase).toBe("running");
    });

    it("passes undefined when no command line was set", () => {
      mockTerminal.receiveOsc633("C");

      expect(callbacks.onCommandExecuted).toHaveBeenCalledWith(undefined);
    });

    it("passes command line when set via E sequence", () => {
      mockTerminal.receiveOsc633("E;npm install");
      mockTerminal.receiveOsc633("C");

      expect(callbacks.onCommandExecuted).toHaveBeenCalledWith("npm install");
    });
  });

  describe("OSC 633;D - Command Finished", () => {
    it("calls onCommandFinished with exit code 0 when no code provided", () => {
      mockTerminal.receiveOsc633("D");

      expect(callbacks.onCommandFinished).toHaveBeenCalledWith(0);
    });

    it("parses exit code from sequence", () => {
      mockTerminal.receiveOsc633("D;0");
      expect(callbacks.onCommandFinished).toHaveBeenCalledWith(0);

      vi.mocked(callbacks.onCommandFinished!).mockClear();

      mockTerminal.receiveOsc633("D;1");
      expect(callbacks.onCommandFinished).toHaveBeenCalledWith(1);

      vi.mocked(callbacks.onCommandFinished!).mockClear();

      mockTerminal.receiveOsc633("D;127");
      expect(callbacks.onCommandFinished).toHaveBeenCalledWith(127);
    });

    it("handles non-numeric exit code gracefully", () => {
      mockTerminal.receiveOsc633("D;error");

      expect(callbacks.onCommandFinished).toHaveBeenCalledWith(0);
    });

    it("transitions to idle phase", () => {
      mockTerminal.receiveOsc633("C"); // Running
      mockTerminal.receiveOsc633("D;0");

      expect(addon.currentPhase).toBe("idle");
    });
  });

  describe("OSC 633;E - Command Line Text", () => {
    it("stores command line for next C sequence", () => {
      mockTerminal.receiveOsc633("E;echo hello");
      mockTerminal.receiveOsc633("C");

      expect(callbacks.onCommandExecuted).toHaveBeenCalledWith("echo hello");
    });

    it("unescapes semicolons in command", () => {
      mockTerminal.receiveOsc633("E;cmd1 \\x3b cmd2");
      mockTerminal.receiveOsc633("C");

      expect(callbacks.onCommandExecuted).toHaveBeenCalledWith("cmd1 ; cmd2");
    });

    it("unescapes backslashes in command", () => {
      mockTerminal.receiveOsc633("E;echo \\\\n");
      mockTerminal.receiveOsc633("C");

      expect(callbacks.onCommandExecuted).toHaveBeenCalledWith("echo \\n");
    });
  });

  describe("OSC 633;P - Property", () => {
    it("calls onCwdChanged for Cwd property", () => {
      mockTerminal.receiveOsc633("P;Cwd=/home/user/project");

      expect(callbacks.onCwdChanged).toHaveBeenCalledWith("/home/user/project");
    });

    it("unescapes path values", () => {
      mockTerminal.receiveOsc633("P;Cwd=/path/with\\x3bsemicolon");

      expect(callbacks.onCwdChanged).toHaveBeenCalledWith(
        "/path/with;semicolon"
      );
    });

    it("ignores unknown properties", () => {
      mockTerminal.receiveOsc633("P;UnknownKey=value");

      // Should not throw, just ignore
      expect(callbacks.onCwdChanged).not.toHaveBeenCalled();
    });

    it("handles malformed property (no equals sign)", () => {
      mockTerminal.receiveOsc633("P;CwdWithoutValue");

      // Should not throw
      expect(callbacks.onCwdChanged).not.toHaveBeenCalled();
    });
  });

  describe("full command lifecycle", () => {
    it("tracks complete command execution flow", () => {
      // Prompt appears
      mockTerminal.receiveOsc633("A");
      expect(addon.currentPhase).toBe("prompt");

      // User starts typing
      mockTerminal.receiveOsc633("B");
      expect(addon.currentPhase).toBe("input");

      // Command text captured
      mockTerminal.receiveOsc633("E;npm test");

      // User presses Enter
      mockTerminal.receiveOsc633("C");
      expect(addon.currentPhase).toBe("running");
      expect(callbacks.onCommandExecuted).toHaveBeenCalledWith("npm test");

      // Command completes
      mockTerminal.receiveOsc633("D;0");
      expect(addon.currentPhase).toBe("idle");
      expect(callbacks.onCommandFinished).toHaveBeenCalledWith(0);

      // CWD may change after command
      mockTerminal.receiveOsc633("P;Cwd=/new/directory");
      expect(callbacks.onCwdChanged).toHaveBeenCalledWith("/new/directory");
    });
  });

  describe("dispose", () => {
    it("disposes registered handlers", () => {
      const disposeHandler =
        mockTerminal.parser.registerOscHandler.mock.results[0].value;

      addon.dispose();

      expect(disposeHandler.dispose).toHaveBeenCalled();
    });

    it("stops callbacks after disposal and releases each handler once", () => {
      mockTerminal.receiveOsc633("A");
      expect(callbacks.onPromptStart).toHaveBeenCalledTimes(1);

      addon.dispose();
      addon.dispose();
      mockTerminal.receiveOsc633("A");

      expect(mockTerminal.activeHandlerCount).toBe(0);
      expect(callbacks.onPromptStart).toHaveBeenCalledTimes(1);
      const handler =
        mockTerminal.parser.registerOscHandler.mock.results[0].value;
      expect(handler.dispose).toHaveBeenCalledTimes(1);
    });

    it("releases registrations from every activated terminal", () => {
      const secondTerminal = createMockTerminal();
      addon.activate(
        secondTerminal as unknown as Parameters<typeof addon.activate>[0]
      );
      expect(mockTerminal.activeHandlerCount).toBe(1);
      expect(secondTerminal.activeHandlerCount).toBe(1);

      addon.dispose();

      expect(mockTerminal.activeHandlerCount).toBe(0);
      expect(secondTerminal.activeHandlerCount).toBe(0);
      mockTerminal.receiveOsc633("C");
      secondTerminal.receiveOsc633("C");
      expect(callbacks.onCommandExecuted).not.toHaveBeenCalled();
    });

    it("does not accumulate handlers across repeated activation and disposal", () => {
      for (let cycle = 0; cycle < 20; cycle += 1) {
        expect(mockTerminal.activeHandlerCount).toBe(1);
        mockTerminal.receiveOsc633("A");
        expect(callbacks.onPromptStart).toHaveBeenCalledTimes(cycle + 1);
        addon.dispose();
        expect(mockTerminal.activeHandlerCount).toBe(0);

        if (cycle < 19) {
          addon.activate(
            mockTerminal as unknown as Parameters<typeof addon.activate>[0]
          );
        }
      }
    });
  });

  describe("instance isolation", () => {
    it("keeps command state and handler disposal local to each addon", () => {
      const secondTerminal = createMockTerminal();
      const secondCallbacks: ShellIntegrationCallbacks = {
        onCommandExecuted: vi.fn(),
        onCommandFinished: vi.fn(),
      };
      const secondAddon = new ShellIntegrationAddon(secondCallbacks);
      secondAddon.activate(
        secondTerminal as unknown as Parameters<typeof secondAddon.activate>[0]
      );

      mockTerminal.receiveOsc633("E;first command");
      secondTerminal.receiveOsc633("E;second command");
      mockTerminal.receiveOsc633("C");
      expect(addon.currentPhase).toBe("running");
      expect(secondAddon.currentPhase).toBe("idle");
      expect(callbacks.onCommandExecuted).toHaveBeenCalledWith("first command");
      expect(secondCallbacks.onCommandExecuted).not.toHaveBeenCalled();

      addon.dispose();
      secondTerminal.receiveOsc633("C");
      secondTerminal.receiveOsc633("D;7");
      expect(secondCallbacks.onCommandExecuted).toHaveBeenCalledWith(
        "second command"
      );
      expect(secondCallbacks.onCommandFinished).toHaveBeenCalledWith(7);
      expect(secondTerminal.activeHandlerCount).toBe(1);

      secondAddon.dispose();
      expect(secondTerminal.activeHandlerCount).toBe(0);
    });
  });
});

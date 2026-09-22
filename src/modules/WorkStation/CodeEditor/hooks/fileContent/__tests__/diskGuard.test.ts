/**
 * Save-time guard against overwriting an agent's work.
 *
 * ORGII's editor shares a working tree with an agent, so a file can be
 * rewritten while a buffer sits open. Before this guard, ⌘S and the close-tab
 * Save button wrote unconditionally and the agent's bytes were gone with no
 * trace.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmSaveOverDiskChanges,
  isFileUnchangedOnDisk,
} from "@src/modules/WorkStation/CodeEditor/hooks/fileContent/diskGuard";

const fs = vi.hoisted(() => ({
  contents: new Map<string, string>(),
  failRead: false,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (path: string) => {
    if (fs.failRead) throw new Error("ENOENT");
    return fs.contents.get(path) ?? "";
  }),
}));

const ask = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask }));

vi.mock("i18next", () => ({
  default: { t: (key: string) => key },
}));

const FILE = "/repo/src/index.ts";

describe("disk guard", () => {
  beforeEach(() => {
    fs.contents.clear();
    fs.failRead = false;
    ask.mockClear();
    ask.mockResolvedValue(true);
  });

  describe("isFileUnchangedOnDisk", () => {
    it("is true when disk still matches the baseline", async () => {
      fs.contents.set(FILE, "original");
      await expect(isFileUnchangedOnDisk(FILE, "original")).resolves.toBe(true);
    });

    it("is false once something else has written the file", async () => {
      fs.contents.set(FILE, "written by the agent");
      await expect(isFileUnchangedOnDisk(FILE, "original")).resolves.toBe(
        false
      );
    });

    it("is true when the file cannot be read, so a save is never blocked", async () => {
      // Refusing here would risk the very edits the guard exists to protect.
      fs.failRead = true;
      await expect(isFileUnchangedOnDisk(FILE, "original")).resolves.toBe(true);
    });
  });

  describe("confirmSaveOverDiskChanges", () => {
    it("saves without prompting when nothing changed underneath", async () => {
      fs.contents.set(FILE, "original");
      await expect(confirmSaveOverDiskChanges(FILE, "original")).resolves.toBe(
        true
      );
      expect(ask).not.toHaveBeenCalled();
    });

    it("prompts before replacing bytes written since the buffer loaded", async () => {
      fs.contents.set(FILE, "written by the agent");
      await expect(confirmSaveOverDiskChanges(FILE, "original")).resolves.toBe(
        true
      );
      expect(ask).toHaveBeenCalledTimes(1);
    });

    it("refuses the save when the user declines", async () => {
      fs.contents.set(FILE, "written by the agent");
      ask.mockResolvedValue(false);
      await expect(confirmSaveOverDiskChanges(FILE, "original")).resolves.toBe(
        false
      );
    });

    it("names the file in the prompt rather than its whole path", async () => {
      fs.contents.set(FILE, "written by the agent");
      await confirmSaveOverDiskChanges(FILE, "original");
      const [, options] = ask.mock.calls[0] as unknown as [
        string,
        { title: string; okLabel: string; cancelLabel: string },
      ];
      // The outcome is a boolean, so translated labels can never change which
      // branch runs — the failure mode the close-tab dialog still has.
      expect(options.okLabel).toBe("actions.overwrite");
      expect(options.cancelLabel).toBe("actions.cancel");
      expect(options.title).toBe("workstation.fileChangedOnDiskTitle");
    });
  });
});

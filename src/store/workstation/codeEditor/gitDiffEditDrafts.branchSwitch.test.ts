import { beforeEach, expect, it, vi } from "vitest";

import {
  clearGitDiffEditDrafts,
  hasGitDiffEditDraft,
  restoreGitDiffEditDraft,
  saveGitDiffDraftForSwitch,
  setGitDiffEditDraft,
} from "./gitDiffEditDrafts";

const fs = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => fs);
beforeEach(() => {
  clearGitDiffEditDrafts();
  vi.resetAllMocks();
});
it("saves an intentionally empty file and removes its draft only after readback", async () => {
  setGitDiffEditDraft("/file", "base", "");
  fs.readTextFile.mockResolvedValueOnce("base").mockResolvedValueOnce("");
  await saveGitDiffDraftForSwitch("/file");
  expect(fs.writeTextFile).toHaveBeenCalledWith("/file", "");
  expect(hasGitDiffEditDraft("/file")).toBe(false);
});
it("retains a draft and does not write over external changes", async () => {
  setGitDiffEditDraft("/file", "base", "mine");
  fs.readTextFile.mockResolvedValue("external");
  await expect(saveGitDiffDraftForSwitch("/file")).rejects.toThrow(
    "changed on disk"
  );
  expect(fs.writeTextFile).not.toHaveBeenCalled();
  expect(hasGitDiffEditDraft("/file")).toBe(true);
});
it("retains later edits if the buffer changes during the awaited write", async () => {
  setGitDiffEditDraft("/file", "base", "mine");
  fs.readTextFile.mockResolvedValueOnce("base").mockResolvedValueOnce("mine");
  fs.writeTextFile.mockImplementation(async () =>
    setGitDiffEditDraft("/file", "base", "later")
  );
  await expect(saveGitDiffDraftForSwitch("/file")).rejects.toThrow(
    "changed while saving"
  );
  expect(restoreGitDiffEditDraft("/file", "mine")).toBe("later");
  expect(hasGitDiffEditDraft("/file")).toBe(true);
});
it("retains the only copy after failed disk IO", async () => {
  setGitDiffEditDraft("/file", "base", "mine");
  fs.readTextFile.mockResolvedValue("base");
  fs.writeTextFile.mockRejectedValue(new Error("disk full"));
  await expect(saveGitDiffDraftForSwitch("/file")).rejects.toThrow("disk full");
  expect(hasGitDiffEditDraft("/file")).toBe(true);
});

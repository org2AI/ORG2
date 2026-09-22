// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ForkSessionSetupSelection } from "./forkDialogState";
import {
  clearForkSetupMemory,
  loadForkSetupMemory,
  saveForkSetupMemory,
} from "./forkSetupMemory";

const storageKey = "orgii:fork-setup-memory-v1";
const selection: ForkSessionSetupSelection = {
  workspaceRepoPath: "/workspace/repo",
  execution: {
    agentDefinitionId: "builtin:sde",
    accountId: "account-a",
    model: "test-model",
  },
};

beforeEach(() => localStorage.removeItem(storageKey));
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(storageKey);
});

describe("fork setup persistence", () => {
  it("preserves the stored format and reloads after module reinitialization", async () => {
    saveForkSetupMemory(" repo-a ", selection);
    const stored = JSON.parse(localStorage.getItem(storageKey)!);
    expect(stored).toEqual({
      "repo-a": { ...selection, savedAt: expect.any(String) },
    });
    vi.resetModules();
    const reloaded = await import("./forkSetupMemory");
    expect(reloaded.loadForkSetupMemory("repo-a")).toEqual(selection);
  });

  it("clears only the selected scope across repeated save and clear cycles", () => {
    saveForkSetupMemory("repo-b", selection);
    saveForkSetupMemory(null, selection);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      saveForkSetupMemory("repo-a", selection);
      expect(loadForkSetupMemory("repo-a")).toEqual(selection);
      clearForkSetupMemory("repo-a");
      expect(loadForkSetupMemory("repo-a")).toBeNull();
      expect(loadForkSetupMemory("repo-b")).toEqual(selection);
      expect(loadForkSetupMemory(undefined)).toEqual(selection);
    }
    clearForkSetupMemory(null);
    expect(loadForkSetupMemory(undefined)).toBeNull();
    expect(loadForkSetupMemory("repo-b")).toEqual(selection);
  });

  it("keeps writes best-effort when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => saveForkSetupMemory("repo-a", selection)).not.toThrow();
    expect(() => clearForkSetupMemory("repo-a")).not.toThrow();
    expect(loadForkSetupMemory("repo-a")).toBeNull();
  });
});

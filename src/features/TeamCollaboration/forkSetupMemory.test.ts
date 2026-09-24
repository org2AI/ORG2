// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ForkSessionSetupSelection } from "./forkDialogState";
import {
  FORK_SETUP_MAX_AGE_MS,
  FORK_SETUP_STORAGE_KEY,
  MAX_FORK_SETUP_ENTRIES,
  clearForkSetupMemory,
  loadForkSetupMemory,
  saveForkSetupMemory,
} from "./forkSetupMemory";

const scope = {
  identityKey: "https://cloud.example|alice",
  orgId: "org-a",
  sourceSessionId: "session-a",
};
const selection: ForkSessionSetupSelection = {
  workspaceRepoPath: "/workspace/repo",
  execution: {
    agentDefinitionId: "builtin:sde",
    accountId: "account-a",
    model: "test-model",
  },
};
beforeEach(() => {
  localStorage.removeItem(FORK_SETUP_STORAGE_KEY);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T00:00:00Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.removeItem(FORK_SETUP_STORAGE_KEY);
  localStorage.removeItem("orgii:fork-setup-memory-v1");
});
describe("identity-scoped bounded fork setup", () => {
  it("persists confirmed choices across module reinitialization", async () => {
    saveForkSetupMemory(" repo-a ", selection, scope);
    vi.resetModules();
    const reloaded = await import("./forkSetupMemory");
    expect(reloaded.loadForkSetupMemory("repo-a", scope)).toEqual(selection);
  });
  it("never reuses another identity, organization or no-repo session", () => {
    saveForkSetupMemory(null, selection, scope);
    expect(loadForkSetupMemory(undefined, scope)).toEqual(selection);
    for (const changed of [
      { ...scope, identityKey: "https://other.example|alice" },
      { ...scope, identityKey: "https://cloud.example|bob" },
      { ...scope, orgId: "org-b" },
      { ...scope, sourceSessionId: "session-b" },
    ]) {
      expect(loadForkSetupMemory(null, changed)).toBeNull();
    }
    expect(loadForkSetupMemory(null, null)).toBeNull();
  });
  it("shares a repo choice within its identity and clears only that scope", () => {
    saveForkSetupMemory("repo-a", selection, scope);
    saveForkSetupMemory("repo-b", selection, scope);
    expect(
      loadForkSetupMemory("repo-a", { ...scope, sourceSessionId: "other" })
    ).toEqual(selection);
    clearForkSetupMemory("repo-a", scope);
    expect(loadForkSetupMemory("repo-a", scope)).toBeNull();
    expect(loadForkSetupMemory("repo-b", scope)).toEqual(selection);
  });
  it("does not attribute old unscoped entries to the current user", () => {
    localStorage.setItem(
      "orgii:fork-setup-memory-v1",
      JSON.stringify({
        "repo-a": { ...selection, savedAt: new Date().toISOString() },
      })
    );
    expect(loadForkSetupMemory("repo-a", scope)).toBeNull();
  });
  it("expires and prunes old choices without timers", () => {
    saveForkSetupMemory("repo-a", selection, scope);
    vi.advanceTimersByTime(FORK_SETUP_MAX_AGE_MS);
    expect(loadForkSetupMemory("repo-a", scope)).toBeNull();
    expect(localStorage.getItem(FORK_SETUP_STORAGE_KEY)).toBe("{}");
  });
  it("bounds repeated scopes and keeps the most recently confirmed entry", () => {
    for (let i = 0; i <= MAX_FORK_SETUP_ENTRIES; i++)
      saveForkSetupMemory(`repo-${i}`, selection, scope);
    expect(
      Object.keys(JSON.parse(localStorage.getItem(FORK_SETUP_STORAGE_KEY)!))
    ).toHaveLength(MAX_FORK_SETUP_ENTRIES);
    expect(loadForkSetupMemory("repo-0", scope)).toBeNull();
    expect(
      loadForkSetupMemory(`repo-${MAX_FORK_SETUP_ENTRIES}`, scope)
    ).toEqual(selection);
  });
  it("rejects malformed choices and tolerates storage failure", () => {
    localStorage.setItem(
      FORK_SETUP_STORAGE_KEY,
      JSON.stringify({
        invalid: {
          execution: { agentDefinitionId: 1 },
          savedAt: new Date().toISOString(),
        },
      })
    );
    expect(loadForkSetupMemory("repo-a", scope)).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => saveForkSetupMemory("repo-a", selection, scope)).not.toThrow();
    expect(() => clearForkSetupMemory("repo-a", scope)).not.toThrow();
  });
});

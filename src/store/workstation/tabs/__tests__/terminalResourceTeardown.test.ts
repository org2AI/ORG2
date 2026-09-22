/**
 * Terminal PTY teardown is owned by the explicit-close command.
 *
 * A `terminal` tab is a shared resource projected only into the workspaces
 * that reference it, so it leaves the presented panel whenever the presented
 * workspace changes. Teardown must therefore key off the close command, never
 * off the tab's presence in the panel — otherwise switching sessions kills
 * every dev server, agent and shell the user has running.
 */
import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import { getSettingsDefaults } from "@src/config/settingsSchema";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import type { Session } from "@src/store/session/sessionAtom/types";
import { workstationActiveSessionIdAtom } from "@src/store/session/viewAtom";
import { settingsAtom } from "@src/store/settings/settingsAtom";
import { terminalSessionsAtom } from "@src/store/workstation/codeEditor/terminal";

import {
  closeWorkstationTabAtom,
  closeWorkstationTabsAtom,
  disposeWorkstationWorkspaceAtom,
  openWorkstationTabAtom,
  presentedWorkstationWorkspaceKeyAtom,
  workstationTabsStateAtom,
} from "../atoms";
import { emptyWorkstationTabsState } from "../storage";

function session(id: string, repoPath: string): Session {
  return {
    session_id: id,
    repoPath,
    status: "idle",
    created_at: "",
    updated_at: "",
  };
}

/** Let the close command's fire-and-forget PTY shutdown settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup() {
  const store = createStore();
  store.set(settingsAtom, getSettingsDefaults());
  // "A" and "B" share a working directory and therefore one workspace;
  // "C" is a worktree of the same repo and gets a workspace of its own.
  store.set(sessionsAtom, [
    session("A", "/repo"),
    session("B", "/repo"),
    session("C", "/repo/worktree"),
  ]);
  store.set(workstationTabsStateAtom, emptyWorkstationTabsState());
  store.set(workstationActiveSessionIdAtom, "A");
  store.set(terminalSessionsAtom, [
    { id: "pty-1", name: "dev server", isActive: true },
    { id: "pty-2", name: "agent", isActive: false },
  ]);
  openTab(store, "terminal", "terminal");
  return store;
}

function openTab(
  store: ReturnType<typeof createStore>,
  id: string,
  type: "file" | "terminal" = "file"
) {
  store.set(openWorkstationTabAtom, {
    workspace: store.get(presentedWorkstationWorkspaceKeyAtom),
    tab: { id, type, title: id, data: {} },
  });
}

function runningPtyIds(store: ReturnType<typeof createStore>): string[] {
  return store.get(terminalSessionsAtom).map((terminal) => terminal.id);
}

/**
 * Teardown leaves one fresh default behind, so it reads as a single session
 * that is neither of the two that were running.
 */
function expectEveryPtyKilled(store: ReturnType<typeof createStore>): void {
  const remaining = store.get(terminalSessionsAtom);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].isDefaultSession).toBe(true);
  expect(["pty-1", "pty-2"]).not.toContain(remaining[0].id);
}

beforeEach(() => localStorage.clear());

describe("terminal resource teardown", () => {
  it("keeps every PTY alive when the presented workspace changes", async () => {
    const store = setup();

    store.set(workstationActiveSessionIdAtom, "C");
    await settle();

    expect(store.get(presentedWorkstationWorkspaceKeyAtom)).toEqual({
      kind: "directory",
      directory: "/repo/worktree",
    });
    expect(runningPtyIds(store)).toEqual(["pty-1", "pty-2"]);
  });

  it("keeps every PTY alive across a round-tripped workspace switch", async () => {
    const store = setup();

    store.set(workstationActiveSessionIdAtom, "C");
    store.set(workstationActiveSessionIdAtom, "A");
    await settle();

    expect(runningPtyIds(store)).toEqual(["pty-1", "pty-2"]);
  });

  it("keeps every PTY alive when another workspace is disposed", async () => {
    const store = setup();

    store.set(disposeWorkstationWorkspaceAtom, "C");
    await settle();

    expect(runningPtyIds(store)).toEqual(["pty-1", "pty-2"]);
  });

  it("kills every PTY when the user closes the Terminal tab", async () => {
    const store = setup();

    store.set(closeWorkstationTabAtom, {
      workspace: store.get(presentedWorkstationWorkspaceKeyAtom),
      tabId: "terminal",
    });
    await settle();

    expectEveryPtyKilled(store);
  });

  it("kills every PTY when the Terminal tab is closed in a bulk close", async () => {
    const store = setup();
    openTab(store, "file-a");
    openTab(store, "file-b");

    store.set(closeWorkstationTabsAtom, {
      workspace: store.get(presentedWorkstationWorkspaceKeyAtom),
      tabIds: ["file-a", "terminal"],
    });
    await settle();

    expectEveryPtyKilled(store);
  });

  it("keeps every PTY alive when a close leaves the Terminal tab open", async () => {
    const store = setup();
    openTab(store, "file-a");

    store.set(closeWorkstationTabAtom, {
      workspace: store.get(presentedWorkstationWorkspaceKeyAtom),
      tabId: "file-a",
    });
    await settle();

    expect(runningPtyIds(store)).toEqual(["pty-1", "pty-2"]);
  });
});

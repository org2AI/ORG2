import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getSettingsDefaults,
  validateSettings,
} from "@src/config/settingsSchema";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import type { Session } from "@src/store/session/sessionAtom/types";
import {
  sessionViewAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session/viewAtom";
import { settingsAtom } from "@src/store/settings/settingsAtom";
import { codeEditorTerminalTargetAtom } from "@src/store/workstation/codeEditor/terminalTargetAtom";

import {
  closeWorkstationTabAtom,
  disposeWorkstationWorkspaceAtom,
  focusWorkstationTabAtom,
  mainPaneStateAtom,
  openWorkstationTabAtom,
  recentWorkstationTabsAtom,
  removeSharedWorkstationTabAtom,
  workstationTabsStateAtom,
} from "../atoms";
import {
  activeEditorRepoAtom,
  editorCacheAtom,
  saveRepoCacheAtom,
} from "../editorCache";
import { consumePendingFileOpens, queueFileOpens } from "../pendingFileOpens";
import {
  emptyWorkstationTabsState,
  loadWorkstationTabsState,
} from "../storage";
import {
  normalizeWorkstationDirectory,
  presentedWorkstationWorkspaceKeyAtom,
  resolveSessionWorkstationWorkspaceKey,
} from "../workspaceScope";

function session(id: string, repoPath?: string): Session {
  return {
    session_id: id,
    repoPath,
    status: "idle",
    created_at: "",
    updated_at: "",
  };
}

function setup() {
  const store = createStore();
  store.set(settingsAtom, getSettingsDefaults());
  store.set(sessionsAtom, [
    session("A", "/repo/"),
    session("B", "/repo"),
    session("C", "/repo/worktree"),
  ]);
  store.set(workstationTabsStateAtom, emptyWorkstationTabsState());
  store.set(workstationActiveSessionIdAtom, "A");
  return store;
}

function open(
  store: ReturnType<typeof createStore>,
  id: string,
  type: "file" | "terminal" = "file",
  data: Record<string, unknown> = {}
) {
  store.set(openWorkstationTabAtom, {
    workspace: store.get(presentedWorkstationWorkspaceKeyAtom),
    tab: { id, type, title: id, data },
  });
}

beforeEach(() => localStorage.clear());

describe("Workstation sharing policy", () => {
  it("defaults to directory sharing and validates the two policy values", () => {
    expect(getSettingsDefaults()["general.myStationSharing"]).toBe(
      "working-directory"
    );
    expect(
      validateSettings({ "general.myStationSharing": "chat-tab" })[
        "general.myStationSharing"
      ]
    ).toBe("chat-tab");
  });

  it("shares tabs, active selection, tab data, recent tabs, terminal selection and editor cache", () => {
    const store = setup();
    open(store, "one", "file", { viewMode: "split" });
    open(store, "two");
    const workspace = store.get(presentedWorkstationWorkspaceKeyAtom);
    store.set(focusWorkstationTabAtom, { workspace, tabId: "one" });
    store.set(codeEditorTerminalTargetAtom, {
      kind: "pty",
      ptySessionId: "pty-A",
    });
    store.set(activeEditorRepoAtom, "/repo");
    store.set(saveRepoCacheAtom, {
      repoPath: "/repo",
      fileTabs: [],
      activeFileTabId: null,
      lastAccessedAt: 1,
    });
    store.set(workstationActiveSessionIdAtom, "B");
    expect(store.get(presentedWorkstationWorkspaceKeyAtom)).toBe(workspace);
    expect(store.get(mainPaneStateAtom).tabs.map((tab) => tab.id)).toEqual([
      "one",
      "two",
    ]);
    expect(store.get(mainPaneStateAtom).activeTabId).toBe("one");
    expect(store.get(mainPaneStateAtom).tabs[0].data.viewMode).toBe("split");
    expect(store.get(recentWorkstationTabsAtom).map((tab) => tab.id)).toContain(
      "two"
    );
    expect(store.get(codeEditorTerminalTargetAtom)).toEqual({
      kind: "pty",
      ptySessionId: "pty-A",
    });
    expect(store.get(activeEditorRepoAtom)).toBe("/repo");
    expect(store.get(editorCacheAtom)["/repo"]).toBeDefined();
    store.set(closeWorkstationTabAtom, { workspace, tabId: "one" });
    store.set(workstationActiveSessionIdAtom, "A");
    expect(store.get(mainPaneStateAtom).tabs.map((tab) => tab.id)).toEqual([
      "two",
    ]);
  });

  it("isolates different working directories including worktrees", () => {
    const store = setup();
    open(store, "one");
    store.set(codeEditorTerminalTargetAtom, {
      kind: "pty",
      ptySessionId: "pty-A",
    });
    store.set(workstationActiveSessionIdAtom, "C");
    expect(store.get(mainPaneStateAtom).tabs).toEqual([]);
    expect(store.get(codeEditorTerminalTargetAtom)).toBeNull();
    expect(store.get(editorCacheAtom)).toEqual({});
    open(store, "other");
    store.set(workstationActiveSessionIdAtom, "A");
    expect(store.get(mainPaneStateAtom).tabs.map((tab) => tab.id)).toEqual([
      "one",
    ]);
  });

  it("switches policies without overwriting either saved workspace", () => {
    const store = setup();
    open(store, "shared");
    store.set(settingsAtom, {
      ...store.get(settingsAtom),
      "general.myStationSharing": "chat-tab",
    });
    expect(store.get(mainPaneStateAtom).tabs).toEqual([]);
    open(store, "only-A");
    store.set(workstationActiveSessionIdAtom, "B");
    expect(store.get(mainPaneStateAtom).tabs).toEqual([]);
    open(store, "only-B");
    store.set(settingsAtom, {
      ...store.get(settingsAtom),
      "general.myStationSharing": "working-directory",
    });
    expect(store.get(mainPaneStateAtom).tabs.map((tab) => tab.id)).toEqual([
      "shared",
    ]);
    store.set(settingsAtom, {
      ...store.get(settingsAtom),
      "general.myStationSharing": "chat-tab",
    });
    expect(store.get(mainPaneStateAtom).tabs.map((tab) => tab.id)).toEqual([
      "only-B",
    ]);
  });

  it("round-trips directory state without losing the per-tab partition", () => {
    const store = setup();
    open(store, "shared");
    store.set(settingsAtom, {
      ...store.get(settingsAtom),
      "general.myStationSharing": "chat-tab",
    });
    open(store, "session-only");
    const loaded = loadWorkstationTabsState();
    expect(loaded.directoryWorkspaces?.["/repo"].tabs[0].id).toBe("shared");
    expect(loaded.sessionWorkspaces.A.tabs[0].id).toBe("session-only");
    store.set(workstationTabsStateAtom, loaded);
    store.set(settingsAtom, {
      ...store.get(settingsAtom),
      "general.myStationSharing": "working-directory",
    });
    expect(store.get(mainPaneStateAtom).tabs[0].id).toBe("shared");
  });

  it("preserves a shared directory when one of its chat sessions is deleted", () => {
    const store = setup();
    open(store, "shared");
    store.set(disposeWorkstationWorkspaceAtom, "A");
    store.set(workstationActiveSessionIdAtom, "B");
    expect(store.get(mainPaneStateAtom).tabs[0].id).toBe("shared");
  });

  it("removes closed live resource references from every directory", () => {
    const store = setup();
    open(store, "pty", "terminal");
    store.set(workstationActiveSessionIdAtom, "C");
    open(store, "pty", "terminal");
    store.set(removeSharedWorkstationTabAtom, "pty");
    expect(store.get(mainPaneStateAtom).tabs).toEqual([]);
    store.set(workstationActiveSessionIdAtom, "A");
    expect(store.get(mainPaneStateAtom).tabs).toEqual([]);
  });

  it("keeps delayed opens attached to their captured directory", () => {
    const store = setup();
    const workspace = store.get(presentedWorkstationWorkspaceKeyAtom);
    queueFileOpens(workspace, [{ path: "/repo/file.ts" }]);
    store.set(workstationActiveSessionIdAtom, "C");
    expect(
      consumePendingFileOpens(store.get(presentedWorkstationWorkspaceKeyAtom))
    ).toEqual([]);
    store.set(workstationActiveSessionIdAtom, "B");
    expect(
      consumePendingFileOpens(store.get(presentedWorkstationWorkspaceKeyAtom))
    ).toEqual([{ path: "/repo/file.ts" }]);
  });

  it("uses the target session's directory for background context", () => {
    const store = setup();
    store.set(workstationActiveSessionIdAtom, "C");
    expect(resolveSessionWorkstationWorkspaceKey(store.get, "B")).toEqual({
      kind: "directory",
      directory: "/repo",
    });
  });

  it("ignores stale view metadata and isolates sessions without a known directory", () => {
    const store = setup();
    store.set(sessionViewAtom, {
      activeSessionId: "unhydrated",
      repoPath: "/repo",
    });
    expect(store.get(presentedWorkstationWorkspaceKeyAtom)).toEqual({
      kind: "session",
      sessionId: "unhydrated",
    });
    store.set(workstationActiveSessionIdAtom, null);
    expect(store.get(presentedWorkstationWorkspaceKeyAtom)).toEqual({
      kind: "global",
    });
  });

  it("clears a deleted agent terminal without removing the shared workspace", () => {
    const store = setup();
    open(store, "shared");
    store.set(codeEditorTerminalTargetAtom, { kind: "agent", sessionId: "A" });
    store.set(disposeWorkstationWorkspaceAtom, "A");
    store.set(workstationActiveSessionIdAtom, "B");
    expect(store.get(codeEditorTerminalTargetAtom)).toBeNull();
    expect(store.get(mainPaneStateAtom).tabs[0].id).toBe("shared");
  });

  it("never shares a remote guest's identically named directory with a local chat", () => {
    const store = setup();
    const remote: Session = {
      ...session("remote", "/repo"),
      importedFrom: {
        orgId: "org",
        sourceSessionId: "source",
        ownerMemberId: "owner",
        epoch: 1,
        seq: 0,
        count: 0,
      },
    };
    store.set(sessionsAtom, (sessions) => [...sessions, remote]);
    open(store, "local-file");
    store.set(workstationActiveSessionIdAtom, "remote");
    expect(store.get(presentedWorkstationWorkspaceKeyAtom)).toEqual({
      kind: "session",
      sessionId: "remote",
    });
    expect(store.get(mainPaneStateAtom).tabs).toEqual([]);
  });

  it.each([undefined, "", ".", "ssh://host/repo"])(
    "isolates non-local or unresolved directory %s",
    (repoPath) => {
      const store = setup();
      store.set(sessionsAtom, [session("A", repoPath)]);
      expect(store.get(presentedWorkstationWorkspaceKeyAtom)).toEqual({
        kind: "session",
        sessionId: "A",
      });
    }
  );

  it("does not invalidate workspace subscribers for session status changes", () => {
    const store = setup();
    let notifications = 0;
    const unsubscribe = store.sub(
      presentedWorkstationWorkspaceKeyAtom,
      () => notifications++
    );
    // Mounting sessionView restores its deliberate null-on-reload selection.
    store.set(workstationActiveSessionIdAtom, "A");
    notifications = 0;
    store.set(sessionsAtom, (sessions) =>
      sessions.map((session) => ({ ...session, status: "running" }))
    );
    store.set(workstationActiveSessionIdAtom, "B");
    expect(notifications).toBe(0);
    unsubscribe();
  });

  it.each([
    ["/repo/", "/repo"],
    ["/", "/"],
    ["", ""],
    ["C:\\repo\\", "C:/repo"],
    ["/Repo", "/Repo"],
    ["C:/", "C:/"],
  ])("normalizes directory identity %s", (path, expected) => {
    expect(normalizeWorkstationDirectory(path)).toBe(expected);
  });
});

import { atom } from "jotai";

import { getChatPanelWorkItemTabKey } from "@src/store/chatPanel/chatPanelTabFactories";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";

import {
  CHAT_PANEL_CONTENT_MODE,
  type ChatPanelContentMode,
  type ChatPanelCreateProjectContext,
  type ChatPanelCreateTarget,
  type ChatPanelSelectedCloudOrg,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedProjectOrg,
  type ChatPanelSelectedWorkItem,
  type ChatPanelSelectedWorkspace,
  DEFAULT_CHAT_PANEL_CREATE_TARGET,
  WORKSPACE_OVERVIEW_TAB,
  type WorkspaceOverviewTab,
} from "./selectionTypes";

// Preserve public import paths; tab models/factories import the types directly.
export * from "./selectionTypes";

export const chatPanelCreateTargetAtom = atom<ChatPanelCreateTarget>(
  DEFAULT_CHAT_PANEL_CREATE_TARGET
);
export const chatPanelStartPageOpenAtom = atom(true);
export const chatPanelCreateProjectContextAtom =
  atom<ChatPanelCreateProjectContext | null>(null);
export const chatPanelWorkspaceOverviewTabAtom = atom<WorkspaceOverviewTab>(
  WORKSPACE_OVERVIEW_TAB.OVERVIEW
);
chatPanelCreateTargetAtom.debugLabel = "chatPanelCreateTargetAtom";
chatPanelStartPageOpenAtom.debugLabel = "chatPanelStartPageOpenAtom";
chatPanelCreateProjectContextAtom.debugLabel =
  "chatPanelCreateProjectContextAtom";
chatPanelWorkspaceOverviewTabAtom.debugLabel =
  "chatPanelWorkspaceOverviewTabAtom";

/** Exactly one non-session selection can own the slot. Creator controls and
 * workspace subnavigation remain orthogonal, independently retained axes. */
interface SelectionPayloads {
  project: ChatPanelSelectedProject;
  projectOrg: ChatPanelSelectedProjectOrg;
  workspace: ChatPanelSelectedWorkspace;
  cloudOrg: ChatPanelSelectedCloudOrg;
}

type ChatPanelSelectionState =
  | { kind: "session" | "creation" | "explore" }
  | {
      kind: "workItem";
      target: { tabId: string } | { inline: ChatPanelSelectedWorkItem };
    }
  | {
      [K in keyof SelectionPayloads]: { kind: K; value: SelectionPayloads[K] };
    }[keyof SelectionPayloads];

export const chatPanelSelectionStateAtom = atom<ChatPanelSelectionState>({
  kind: "session",
});
chatPanelSelectionStateAtom.debugLabel = "chatPanelSelectionStateAtom";

type Update<T> = T | ((previous: T) => T);

function selectionAtom<T extends object>(
  read: (selection: ChatPanelSelectionState) => T | null,
  select: (value: T) => ChatPanelSelectionState
) {
  return atom(
    (get): T | null => read(get(chatPanelSelectionStateAtom)),
    (get, set, update: Update<T | null>) => {
      const previous = read(get(chatPanelSelectionStateAtom));
      const value = typeof update === "function" ? update(previous) : update;
      if (value === previous) return;
      if (value) {
        set(chatPanelSelectionStateAtom, select(value));
      } else if (previous) {
        set(chatPanelSelectionStateAtom, { kind: "creation" });
      }
    }
  );
}

export const chatPanelSelectedProjectAtom = selectionAtom(
  (state) => (state.kind === "project" ? state.value : null),
  (value) => ({ kind: "project", value })
);
export const chatPanelSelectedProjectOrgAtom = selectionAtom(
  (state) => (state.kind === "projectOrg" ? state.value : null),
  (value) => ({ kind: "projectOrg", value })
);
export const chatPanelSelectedWorkspaceAtom = selectionAtom(
  (state) => (state.kind === "workspace" ? state.value : null),
  (value) => ({ kind: "workspace", value })
);
export const chatPanelSelectedCloudOrgAtom = selectionAtom(
  (state) => (state.kind === "cloudOrg" ? state.value : null),
  (value) => ({ kind: "cloudOrg", value })
);
chatPanelSelectedProjectAtom.debugLabel = "chatPanelSelectedProjectAtom";
chatPanelSelectedProjectOrgAtom.debugLabel = "chatPanelSelectedProjectOrgAtom";
chatPanelSelectedWorkspaceAtom.debugLabel = "chatPanelSelectedWorkspaceAtom";
chatPanelSelectedCloudOrgAtom.debugLabel = "chatPanelSelectedCloudOrgAtom";

/** Work-item tabs own their payload; selection retains only the tab ID.
 * Direct navigation without a tab retains one inline payload instead. */
export const chatPanelSelectedWorkItemAtom = atom(
  (get): ChatPanelSelectedWorkItem | null => {
    const selection = get(chatPanelSelectionStateAtom);
    if (selection.kind !== "workItem") return null;
    const target = selection.target;
    return "inline" in target
      ? target.inline
      : (get(chatPanelTabsAtom).tabs.find((tab) => tab.id === target.tabId)
          ?.workItem ?? null);
  },
  (get, set, update: Update<ChatPanelSelectedWorkItem | null>) => {
    const previous = get(chatPanelSelectedWorkItemAtom);
    const value = typeof update === "function" ? update(previous) : update;
    if (!value) {
      if (get(chatPanelSelectionStateAtom).kind === "workItem") {
        set(chatPanelSelectionStateAtom, { kind: "creation" });
      }
      return;
    }
    const state = get(chatPanelTabsAtom);
    const key = getChatPanelWorkItemTabKey(value);
    const target = state.tabs.find(
      (tab) =>
        tab.type === "work-item" &&
        tab.workItem &&
        getChatPanelWorkItemTabKey(tab.workItem) === key
    );
    if (target) {
      if (target.workItem !== value) {
        set(chatPanelTabsAtom, {
          ...state,
          tabs: state.tabs.map((tab) =>
            tab.id === target.id
              ? {
                  ...tab,
                  workItem: value,
                  title: value.workItem.name || tab.title,
                }
              : tab
          ),
        });
      }
      const selection = get(chatPanelSelectionStateAtom);
      if (
        selection.kind === "workItem" &&
        "tabId" in selection.target &&
        selection.target.tabId === target.id
      )
        return;
      set(chatPanelSelectionStateAtom, {
        kind: "workItem",
        target: { tabId: target.id },
      });
    } else if (value !== previous) {
      set(chatPanelSelectionStateAtom, {
        kind: "workItem",
        target: { inline: value },
      });
    }
  }
);
chatPanelSelectedWorkItemAtom.debugLabel = "chatPanelSelectedWorkItemAtom";

export const chatPanelContentModeAtom = atom(
  (get): ChatPanelContentMode =>
    get(chatPanelSelectionStateAtom).kind === "session"
      ? CHAT_PANEL_CONTENT_MODE.SESSION
      : CHAT_PANEL_CONTENT_MODE.NON_SESSION,
  (get, set, update: Update<ChatPanelContentMode>) => {
    const previous = get(chatPanelContentModeAtom);
    const mode = typeof update === "function" ? update(previous) : update;
    if (mode === previous) return;
    set(chatPanelSelectionStateAtom, {
      kind: mode === CHAT_PANEL_CONTENT_MODE.SESSION ? "session" : "creation",
    });
  }
);
chatPanelContentModeAtom.debugLabel = "chatPanelContentModeAtom";

export const chatPanelExploreOpenAtom = atom(
  (get) => get(chatPanelSelectionStateAtom).kind === "explore",
  (get, set, update: Update<boolean>) => {
    const previous = get(chatPanelExploreOpenAtom);
    const open = typeof update === "function" ? update(previous) : update;
    if (open === previous) return;
    set(chatPanelSelectionStateAtom, { kind: open ? "explore" : "creation" });
  }
);
chatPanelExploreOpenAtom.debugLabel = "chatPanelExploreOpenAtom";

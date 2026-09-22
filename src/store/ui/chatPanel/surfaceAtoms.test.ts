import { beforeEach, describe, expect, it } from "vitest";

import { resolveChatPanelContentState } from "@src/engines/ChatPanel/hooks/chatPanelContentState";
import {
  openCreateTargetInChatPanelStartPageAtom,
  openExploreInChatPanelTabAtom,
  openOrganizationInChatPanelTabAtom,
  openProjectInChatPanelTabAtom,
  openSessionInNewChatTabAtom,
  openWorkItemInChatPanelTabAtom,
  openWorkspaceOverviewInChatPanelTabAtom,
} from "@src/store/chatPanel/chatPanelTabsAtom";
import { CHAT_PANEL_SURFACE_KIND as KIND } from "@src/types/ui/chatPanel";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedWorkItem,
  DEFAULT_CHAT_PANEL_CREATE_TARGET,
  WORKSPACE_OVERVIEW_TAB,
  chatPanelCreateProjectContextAtom,
  chatPanelCreateTargetAtom,
  chatPanelCreatorWorkItemContextAtom,
  chatPanelSelectedCloudOrgAtom,
  chatPanelSelectedProjectAtom,
  chatPanelSelectedProjectOrgAtom,
  chatPanelSelectedWorkItemAtom,
  chatPanelStartPageOpenAtom,
  chatPanelWorkspaceOverviewTabAtom,
} from "./selectionAtoms";
import {
  activeChatPanelSurfaceAtom,
  chatPanelContentModeAtom,
  resetChatPanelSessionSurfaceAtom,
} from "./surfaceAtoms";

type Store = ReturnType<typeof createInstrumentedStore>;

const project = {
  project: { id: "p", name: "Project" },
  projectSlug: "project",
  orgId: "org",
} as ChatPanelSelectedProject;
const workItem = {
  workItem: { session_id: "w", name: "Work" },
  shortId: "W-1",
  projectId: "p",
  projectName: "Project",
  projectSlug: "project",
  orgId: "org",
} as ChatPanelSelectedWorkItem;
const workspace = { kind: "repo", id: "repo", name: "Repo" } as const;
const projectOrg = {
  orgId: "org",
  orgName: "Org",
  orgScope: "project_org",
} as const;

/** One entry point per surface kind, each expressed as a tab open. */
const destinations: { kind: string; open: (store: Store) => void }[] = [
  {
    kind: KIND.SESSION,
    open: (store) => store.set(openSessionInNewChatTabAtom, "session-1"),
  },
  {
    kind: KIND.NEW_PROJECT,
    open: (store) =>
      store.set(openCreateTargetInChatPanelStartPageAtom, {
        target: CHAT_PANEL_CREATE_TARGET.PROJECT,
        createProjectContext: { orgId: "org" },
      }),
  },
  {
    kind: KIND.NEW_WORK_ITEM,
    open: (store) =>
      store.set(openCreateTargetInChatPanelStartPageAtom, {
        target: CHAT_PANEL_CREATE_TARGET.WORK_ITEM,
      }),
  },
  {
    kind: KIND.PROJECT,
    open: (store) => store.set(openProjectInChatPanelTabAtom, project),
  },
  {
    kind: KIND.PROJECT_ORG,
    open: (store) =>
      store.set(openOrganizationInChatPanelTabAtom, {
        organization: { kind: "local", projectOrg },
      }),
  },
  {
    kind: KIND.WORK_ITEM,
    open: (store) => store.set(openWorkItemInChatPanelTabAtom, workItem),
  },
  {
    kind: KIND.WORKSPACE_EXPLORE,
    open: (store) => store.set(openExploreInChatPanelTabAtom),
  },
  {
    kind: KIND.WORKSPACE_OVERVIEW,
    open: (store) =>
      store.set(openWorkspaceOverviewInChatPanelTabAtom, { workspace }),
  },
  {
    kind: KIND.CLOUD_ORG,
    open: (store) =>
      store.set(openOrganizationInChatPanelTabAtom, {
        organization: { kind: "cloud", cloudOrg: { orgId: "cloud" } },
      }),
  },
];

const SELECTION_KINDS = new Set<string>([
  KIND.PROJECT,
  KIND.PROJECT_ORG,
  KIND.WORK_ITEM,
  KIND.CLOUD_ORG,
]);

describe("tab-derived chat-panel surface", () => {
  beforeEach(() => {
    resetInstrumentedStore();
  });

  it.each(destinations)(
    "presents $kind from every prior surface without stale selections",
    (destination) => {
      const store = createInstrumentedStore();
      for (const source of destinations) {
        source.open(store);
        destination.open(store);
        const surface = store.get(activeChatPanelSurfaceAtom);
        expect(surface.kind).toBe(destination.kind);
        const selections = [
          store.get(chatPanelSelectedProjectAtom),
          store.get(chatPanelSelectedProjectOrgAtom),
          store.get(chatPanelSelectedWorkItemAtom),
          store.get(chatPanelSelectedCloudOrgAtom),
        ].filter(Boolean);
        expect(selections.length).toBe(
          SELECTION_KINDS.has(destination.kind) ? 1 : 0
        );
        expect(store.get(chatPanelContentModeAtom)).toBe(
          destination.kind === KIND.SESSION
            ? CHAT_PANEL_CONTENT_MODE.SESSION
            : CHAT_PANEL_CONTENT_MODE.NON_SESSION
        );
        const contentState = resolveChatPanelContentState({
          currentSessionId: "still-loaded-session",
          surface,
        });
        expect(contentState.showSessionContent).toBe(
          destination.kind === KIND.SESSION
        );
      }
    }
  );

  it("carries the tab payload on the surface", () => {
    const store = createInstrumentedStore();
    store.set(openWorkspaceOverviewInChatPanelTabAtom, { workspace });
    expect(store.get(activeChatPanelSurfaceAtom)).toEqual({
      kind: KIND.WORKSPACE_OVERVIEW,
      workspace,
      tab: WORKSPACE_OVERVIEW_TAB.OVERVIEW,
    });
    store.set(openOrganizationInChatPanelTabAtom, {
      organization: { kind: "cloud", cloudOrg: { orgId: "cloud" } },
    });
    expect(store.get(activeChatPanelSurfaceAtom)).toEqual({
      kind: KIND.CLOUD_ORG,
      cloudOrg: { orgId: "cloud" },
    });
    expect(store.get(chatPanelSelectedCloudOrgAtom)).toEqual({
      orgId: "cloud",
    });
  });

  it("only maps the project and work-item creator targets to creator surfaces", () => {
    const store = createInstrumentedStore();
    store.set(chatPanelCreateTargetAtom, CHAT_PANEL_CREATE_TARGET.PARALLEL_RUN);
    expect(store.get(activeChatPanelSurfaceAtom).kind).toBe(KIND.SESSION);
    store.set(chatPanelCreateTargetAtom, CHAT_PANEL_CREATE_TARGET.WORK_ITEM);
    expect(store.get(activeChatPanelSurfaceAtom).kind).toBe(KIND.NEW_WORK_ITEM);
  });

  it("retains a created work item for the creator until the next activation", () => {
    const store = createInstrumentedStore();
    store.set(chatPanelCreatorWorkItemContextAtom, workItem);
    expect(store.get(chatPanelSelectedWorkItemAtom)).toBe(workItem);
    store.set(openSessionInNewChatTabAtom, "session-1");
    expect(store.get(chatPanelCreatorWorkItemContextAtom)).toBeNull();
    expect(store.get(chatPanelSelectedWorkItemAtom)).toBeNull();
  });

  it("resets every creator axis and the Launchpad flag", () => {
    const store = createInstrumentedStore();
    store.set(openCreateTargetInChatPanelStartPageAtom, {
      target: CHAT_PANEL_CREATE_TARGET.PROJECT,
      createProjectContext: { orgId: "org" },
    });
    store.set(chatPanelCreatorWorkItemContextAtom, workItem);
    store.set(
      chatPanelWorkspaceOverviewTabAtom,
      WORKSPACE_OVERVIEW_TAB.DETAILS
    );
    expect(store.get(chatPanelStartPageOpenAtom)).toBe(true);
    expect(store.get(activeChatPanelSurfaceAtom).kind).toBe(KIND.NEW_PROJECT);

    store.set(resetChatPanelSessionSurfaceAtom);

    expect(store.get(chatPanelCreateTargetAtom)).toBe(
      DEFAULT_CHAT_PANEL_CREATE_TARGET
    );
    expect(store.get(chatPanelCreateProjectContextAtom)).toBeNull();
    expect(store.get(chatPanelCreatorWorkItemContextAtom)).toBeNull();
    expect(store.get(chatPanelWorkspaceOverviewTabAtom)).toBe(
      WORKSPACE_OVERVIEW_TAB.OVERVIEW
    );
    expect(store.get(chatPanelStartPageOpenAtom)).toBe(false);
    expect(store.get(activeChatPanelSurfaceAtom).kind).toBe(KIND.SESSION);
  });

  it("preserves workspace subnavigation across workspace visits and resets it elsewhere", () => {
    const store = createInstrumentedStore();
    store.set(
      chatPanelWorkspaceOverviewTabAtom,
      WORKSPACE_OVERVIEW_TAB.DETAILS
    );
    store.set(openWorkspaceOverviewInChatPanelTabAtom, { workspace });
    expect(store.get(activeChatPanelSurfaceAtom)).toMatchObject({
      tab: WORKSPACE_OVERVIEW_TAB.DETAILS,
    });
    store.set(openWorkspaceOverviewInChatPanelTabAtom, {
      workspace: { kind: "repo", id: "r2", name: "Repo 2" },
      tab: WORKSPACE_OVERVIEW_TAB.OVERVIEW,
    });
    expect(store.get(chatPanelWorkspaceOverviewTabAtom)).toBe(
      WORKSPACE_OVERVIEW_TAB.OVERVIEW
    );
    store.set(
      chatPanelWorkspaceOverviewTabAtom,
      WORKSPACE_OVERVIEW_TAB.DETAILS
    );
    store.set(openExploreInChatPanelTabAtom);
    expect(store.get(chatPanelWorkspaceOverviewTabAtom)).toBe(
      WORKSPACE_OVERVIEW_TAB.OVERVIEW
    );

    store.set(openCreateTargetInChatPanelStartPageAtom, {
      target: CHAT_PANEL_CREATE_TARGET.PROJECT,
      createProjectContext: { orgId: "org" },
    });
    expect(store.get(chatPanelCreateProjectContextAtom)).toEqual({
      orgId: "org",
    });
    store.set(openOrganizationInChatPanelTabAtom, {
      organization: { kind: "local", projectOrg },
    });
    expect(store.get(chatPanelCreateProjectContextAtom)).toBeNull();
  });
});

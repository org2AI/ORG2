/**
 * Work-management surface tab open atoms: the Work tab, workspace overview,
 * organization, work item and project pills.
 */
import { atom } from "jotai";

import {
  type ChatPanelSelectedOrganization,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedWorkItem,
} from "@src/store/ui/chatPanel/selectionAtoms";
import {
  WORK_MANAGEMENT_SECTION,
  type WorkManagementSection,
} from "@src/store/workstation/workstationTabBarAtoms";

import {
  createOrganizationTab,
  createProjectTab,
  createWorkItemTab,
  createWorkManagementTab,
  getChatPanelWorkItemTabKey,
} from "../chatPanelTabFactories";
import {
  activateChatPanelTabAtom,
  appendAndActivateChatPanelTabAtom,
} from "../chatPanelTabPresentationAtoms";
import {
  getWorkManagementFallbackTitle,
  isWorkManagementListSection,
} from "../chatPanelTabsModel";
import { chatPanelTabsAtom } from "../chatPanelTabsState";
import { openOrFocusChatPanelTab } from "./openOrFocus";

interface OpenWorkManagementTabOptions {
  section?: WorkManagementSection;
  title?: string;
}

/** Open or focus Kanban, or reuse the single Work tab for a list dataset. */
export const openWorkManagementChatPanelTabAtom = atom(
  null,
  (get, set, options: OpenWorkManagementTabOptions = {}) => {
    const {
      section = WORK_MANAGEMENT_SECTION.KANBAN,
      title = getWorkManagementFallbackTitle(section),
    } = options;
    const state = get(chatPanelTabsAtom);
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    const requestedListSection = isWorkManagementListSection(section);
    const activeWorkListTab =
      activeTab?.type === "work-management" &&
      activeTab.managementSection &&
      isWorkManagementListSection(activeTab.managementSection)
        ? activeTab
        : undefined;
    const existingTab =
      (requestedListSection ? activeWorkListTab : undefined) ??
      state.tabs.find(
        (tab) =>
          tab.type === "work-management" &&
          (requestedListSection
            ? Boolean(
                tab.managementSection &&
                isWorkManagementListSection(tab.managementSection)
              )
            : tab.managementSection === WORK_MANAGEMENT_SECTION.KANBAN)
      );
    if (existingTab) {
      if (
        existingTab.title !== title ||
        existingTab.managementSection !== section
      ) {
        set(chatPanelTabsAtom, {
          ...state,
          tabs: state.tabs.map((tab) =>
            tab.id === existingTab.id
              ? { ...tab, title, managementSection: section }
              : tab
          ),
        });
      }
      set(activateChatPanelTabAtom, existingTab.id);
      return existingTab.id;
    }

    const tab = createWorkManagementTab({ section, title });
    set(appendAndActivateChatPanelTabAtom, { tab });
    return tab.id;
  }
);
openWorkManagementChatPanelTabAtom.debugLabel =
  "openWorkManagementChatPanelTab";

interface OpenOrganizationManagementTabOptions {
  organization: ChatPanelSelectedOrganization;
  title?: string;
}

/**
 * Open or focus the singleton organization tab. Switching between cloud and
 * local organizations updates the discriminated payload in place so every
 * organization entry point shares one durable tab and presentation.
 */
export const openOrganizationInChatPanelTabAtom = atom(
  null,
  (get, set, options: OpenOrganizationManagementTabOptions) => {
    const { organization, title = "Manage ORG" } = options;
    return openOrFocusChatPanelTab(get, set, {
      isMatch: (tab) => tab.type === "organization",
      refresh: (tab) => ({ ...tab, title, organization }),
      create: () => createOrganizationTab({ organization, title }),
    });
  }
);
openOrganizationInChatPanelTabAtom.debugLabel =
  "openOrganizationInChatPanelTab";

/**
 * Open — or focus, if already open — a dedicated tab for a work item. Each
 * work item gets its own pill (deduped by organization, project, and short
 * ID); the work-item panel renders from the tab payload. Re-opening refreshes
 * the stored payload (name / status can drift) before focusing.
 */
export const openWorkItemInChatPanelTabAtom = atom(
  null,
  (get, set, workItem: ChatPanelSelectedWorkItem) => {
    const workItemKey = getChatPanelWorkItemTabKey(workItem);
    return openOrFocusChatPanelTab(get, set, {
      isMatch: (tab) =>
        tab.type === "work-item" &&
        tab.workItem !== undefined &&
        getChatPanelWorkItemTabKey(tab.workItem) === workItemKey,
      refresh: (tab) => ({
        ...tab,
        title: workItem.workItem.name || tab.title,
        workItem,
      }),
      create: () => createWorkItemTab({ workItem }),
    });
  }
);
openWorkItemInChatPanelTabAtom.debugLabel = "openWorkItemInChatPanelTab";

/** Open or focus a dedicated tab for a project (deduped by slug). */
export const openProjectInChatPanelTabAtom = atom(
  null,
  (get, set, project: ChatPanelSelectedProject) =>
    openOrFocusChatPanelTab(get, set, {
      isMatch: (tab) =>
        tab.type === "project" &&
        tab.project?.projectSlug === project.projectSlug,
      refresh: (tab) => ({
        ...tab,
        title: project.project.name || tab.title,
        project,
      }),
      create: () => createProjectTab({ project }),
    })
);
openProjectInChatPanelTabAtom.debugLabel = "openProjectInChatPanelTab";

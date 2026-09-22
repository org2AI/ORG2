import type React from "react";

import type { WorkstationTabHeaderHost } from "@src/hooks/tabHost/useWorkstationTabHeader";
import type { ProjectManagerBreadcrumbSegment } from "@src/modules/ProjectManager/shared/components/ProjectManagerBreadcrumb";
import type { ProjectDetailSurfaceView } from "@src/store/workstation/tabs";
import type { WorkItem } from "@src/types/core/workItem";

import type { EmbeddedWorkItemDetailState } from "./hooks/useWorkItemsTabBarState";

export interface WorkItemsPageProps {
  breadcrumbSegments?: readonly ProjectManagerBreadcrumbSegment[];
  /** Project ID from the active tab */
  projectId: string;
  /** Project name from the active tab (for display) */
  projectName: string;
  /** Display title override for aggregate Work Items surfaces. */
  pageTitle?: string;
  /** Cached project slug from tab data — enables parallel work item loading */
  cachedProjectSlug?: string;
  /** Workspace path used by editor context menus. */
  repoPath?: string | null;
  /** Surface to show for the project detail tab. */
  projectView?: ProjectDetailSurfaceView;
  /** Persist project detail surface changes to the owning tab. */
  onProjectViewChange?: (view: ProjectDetailSurfaceView) => void;
  /** Called when the resolved project slug is known, so the layout can persist it to the tab */
  onProjectSlugResolved?: (slug: string) => void;
  /** Navigate back to the Projects index from the breadcrumb. */
  onOpenProjects?: () => void;
  /** Callback to open the "New Project" modal */
  onCreateProject?: () => void;
  /** Callback to open a "New Work Item" tab */
  onCreateWorkItem?: (
    projectId: string,
    projectName: string,
    projectSlug: string
  ) => void;
  /** Callback after project is deleted (e.g. close the tab) */
  onProjectDeleted?: () => void;
  /** Notify parent tab system about unsaved changes (for dot indicator) */
  onSetUnsaved?: (unsaved: boolean) => void;
  /** Notify parent tab system when the project title changes */
  onProjectNameUpdated?: (projectName: string) => void;
  /** Navigate to repo-level settings (Projects > Settings tab) */
  onOpenRepoSettings?: () => void;
  /** Open a work item in its own dedicated tab (carries unsaved changes) */
  onExpandWorkItemToTab?: (
    workItemId: string,
    workItemName: string,
    pendingUpdates?: Record<string, unknown>,
    workItemStatus?: string,
    workItem?: WorkItem
  ) => void;
  /** Open an agent session in a chat tab */
  onOpenChatSession?: (sessionId: string, title?: string) => void;
  /** Report whether this project tab is showing its list or an embedded work item detail. */
  onEmbeddedWorkItemDetailStateChange?: (
    tabId: string,
    state: EmbeddedWorkItemDetailState
  ) => void;
  /** Whether this tab is the currently visible tab (gates background refreshes) */
  isActive?: boolean;
  /**
   * When set (Workstation Project Manager), Info / Add work item are shown on
   * the Workstation tab bar instead of the page header.
   */
  workStationTabId?: string;
  /** Target workstation host slot for the published 36px header. */
  workstationHeaderHost?: WorkstationTabHeaderHost;
  /** Parent-owned context control shown before split-list header content. */
  splitHeaderLeading?: React.ReactNode;
}

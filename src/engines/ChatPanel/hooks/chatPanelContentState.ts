import {
  CHAT_PANEL_CONTENT_MODE,
  type ChatPanelContentMode,
} from "@src/store/ui/chatPanel/selectionAtoms";
import type { ChatPanelSurfaceState } from "@src/store/ui/chatPanel/surfaceAtoms";
import { CHAT_PANEL_SURFACE_KIND } from "@src/types/ui/chatPanel";

interface ChatPanelContentStateOptions {
  active: boolean;
  contentMode: ChatPanelContentMode;
  currentSessionId: string | null;
  surface: ChatPanelSurfaceState;
}

export interface ChatPanelContentState {
  showCloudOrgContent: boolean;
  showExploreContent: boolean;
  showExplicitNonSessionContent: boolean;
  showHeader: boolean;
  showPanelContent: boolean;
  showProjectContent: boolean;
  showProjectOrgContent: boolean;
  showSessionContent: boolean;
  showWorkItemContent: boolean;
  showWorkspaceOverviewContent: boolean;
}

export function resolveChatPanelContentState({
  active,
  contentMode,
  currentSessionId,
  surface,
}: ChatPanelContentStateOptions): ChatPanelContentState {
  const showSessionContent =
    active &&
    surface.kind === CHAT_PANEL_SURFACE_KIND.SESSION &&
    contentMode === CHAT_PANEL_CONTENT_MODE.SESSION &&
    Boolean(currentSessionId);
  const showWorkItemContent =
    surface.kind === CHAT_PANEL_SURFACE_KIND.WORK_ITEM;
  const showProjectContent = surface.kind === CHAT_PANEL_SURFACE_KIND.PROJECT;
  const showProjectOrgContent =
    surface.kind === CHAT_PANEL_SURFACE_KIND.PROJECT_ORG;
  const showExploreContent =
    surface.kind === CHAT_PANEL_SURFACE_KIND.WORKSPACE_EXPLORE;
  const showCloudOrgContent =
    surface.kind === CHAT_PANEL_SURFACE_KIND.CLOUD_ORG;
  const showWorkspaceOverviewContent =
    surface.kind === CHAT_PANEL_SURFACE_KIND.WORKSPACE_OVERVIEW;
  const showExplicitNonSessionContent =
    contentMode === CHAT_PANEL_CONTENT_MODE.NON_SESSION;
  const showPanelContent =
    active ||
    showWorkItemContent ||
    showProjectContent ||
    showProjectOrgContent ||
    showExploreContent ||
    showCloudOrgContent ||
    showWorkspaceOverviewContent ||
    showExplicitNonSessionContent;
  const showHeader =
    showWorkItemContent ||
    showProjectContent ||
    showProjectOrgContent ||
    showExploreContent ||
    showCloudOrgContent ||
    showWorkspaceOverviewContent ||
    showExplicitNonSessionContent ||
    active;

  return {
    showCloudOrgContent,
    showExploreContent,
    showExplicitNonSessionContent,
    showHeader,
    showPanelContent,
    showProjectContent,
    showProjectOrgContent,
    showSessionContent,
    showWorkItemContent,
    showWorkspaceOverviewContent,
  };
}

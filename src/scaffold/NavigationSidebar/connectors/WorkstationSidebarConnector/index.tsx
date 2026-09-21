import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { useAppNavigate as useNavigate } from "@src/hooks/navigation/useAppNavigate";
import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { teamInboxUnreadCountAtom } from "@src/modules/MainApp/TeamInbox/store";
import { useTeamInboxDataSource } from "@src/modules/MainApp/TeamInbox/useTeamInboxDataSource";
import { openAgentSessionSearchSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";
import {
  activeSessionCreatorDraftIdAtom,
  deleteSessionCreatorDraftAtom,
  promoteActiveSessionCreatorDraftAtom,
  sessionCreatorDraftListAtom,
  sessionLoadingAtom,
  sessionPaginationAtom,
  sessionsAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import {
  sessionSidebarRevealRequestAtom,
  sidebarCollapsedAtom,
} from "@src/store/ui/sidebarAtom";

import { SidebarBottomBar } from "../../blocks";
import SidebarSettingsMenuButton from "../../blocks/SidebarSettingsMenuButton";
import NavigationSidebar from "../../variants/NavigationSidebar";
import SidebarAccountButton from "../SidebarAccountButton";
import { useDesktopSessionRoster } from "./DesktopSessionRosterProvider";
import { SessionSidebarViewSwitcher } from "./SessionSidebarViewSwitcher";
import { SidebarDialogs } from "./SidebarDialogs";
import { useWorkstationSidebarBottomActions } from "./sidebarConnector.bottomActions";
import { useWorkstationSidebarChatPanelAtoms } from "./sidebarConnector.chatPanelAtoms";
import { useWorkstationSidebarChrome } from "./sidebarConnector.chrome";
import { useWorkstationSidebarCloudMenuData } from "./sidebarConnector.cloudMenuData";
import { buildWorkstationSidebarLabels } from "./sidebarConnector.labels";
import { useWorkstationSidebarPinnedAndRevealData } from "./sidebarConnector.pinnedAndRevealData";
import { useWorkstationSidebarRevealNavigationEffects } from "./sidebarConnector.revealNavigationEffects";
import { useWorkstationSidebarSectionPresentation } from "./sidebarConnector.sectionPresentation";
import { useWorkstationSidebarSelectionAndCollapse } from "./sidebarConnector.selectionAndCollapse";
import { useWorkstationSidebarSessionInteractionHandlers } from "./sidebarConnector.sessionInteractionHandlers";
import { useSidebarSessionRefreshAction } from "./sidebarSessionRefresh";
import type { SessionSidebarView } from "./types";
import { useSessionSidebarOrdering } from "./useSessionSidebarOrdering";
import { useSessionSidebarRowActions } from "./useSessionSidebarRowActions";
import { useSidebarStationNavigation } from "./useSidebarStationNavigation";
import { useWorkItemsSidebarSurface } from "./useWorkItemsSidebarSurface";

export const WorkstationSidebarConnector: React.FC = () => {
  const { t } = useTranslation("navigation");
  const { t: tProjects } = useTranslation("projects");
  const { t: tSessions } = useTranslation("sessions");
  const { t: tCommonRaw } = useTranslation();
  const tCommon = useCallback(
    (key: string, defaultValue?: string) => tCommonRaw(key, { defaultValue }),
    [tCommonRaw]
  );
  const location = useLocation();
  const navigate = useNavigate();
  const sessions = useAtomValue(sessionsAtom);
  useTeamInboxDataSource();
  const teamInboxUnreadCount = useAtomValue(teamInboxUnreadCountAtom);
  const sessionsLoading = useAtomValue(sessionLoadingAtom);
  const sessionPagination = useAtomValue(sessionPaginationAtom);
  const sessionSidebarRevealRequest = useAtomValue(
    sessionSidebarRevealRequestAtom
  );
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom);
  const sessionCreatorDrafts = useAtomValue(sessionCreatorDraftListAtom);
  const activeSessionCreatorDraftId = useAtomValue(
    activeSessionCreatorDraftIdAtom
  );
  const promoteActiveSessionCreatorDraft = useSetAtom(
    promoteActiveSessionCreatorDraftAtom
  );
  const deleteSessionCreatorDraft = useSetAtom(deleteSessionCreatorDraftAtom);
  const { refreshSpinClass, handleRefreshSessions } =
    useSidebarSessionRefreshAction();

  const {
    chatPanelContentMode,
    chatPanelCreateTarget,
    chatPanelSelectedWorkItem,
    chatPanelSelectedProject,
    setChatPanelCreateTarget,
    resetChatPanelSessionSurface,
    setStationChatVisible,
    setStationMode,
    activeWorkManagementSection,
    workManagementProjectsView,
    setWorkManagementProjectsView,
    openWorkManagementTab,
    openOrganizationTab,
    openSessionInNewChatTab,
    openSessionInWorkstation,
    openSessionInNewWindow,
    openOrReplaceSessionInChatPanelTab,
    activateChatPanelTab,
    openStartPageTab,
    openRuntimeTab,
    openTeamInboxTab,
    closeAndDestroyChatPanelTab,
    closeOtherThanActiveChatPanelTabs,
  } = useWorkstationSidebarChatPanelAtoms();

  const { openSession } = useSessionView();
  const activeSessionId = useAtomValue(workstationActiveSessionIdAtom) ?? "";
  const { goToNewSession, navigateTo } = useAppNavigation();
  const [activeViewKey, setActiveViewKey] =
    useState<SessionSidebarView>("sessions");
  const workItemsContentVisible = activeViewKey === "work-items";

  const roster = useDesktopSessionRoster();
  const {
    scope,
    customSections,
    setGroupVisibleCounts,
    expandedSubagentParentIds,
    setExpandedSubagentParentIds,
    setSavedCustomCollapsed,
    collapsedSectionIds,
    setCollapsedSectionIds,
    activeSessionSidebarRevealRequest,
    projection,
    cloudSection,
  } = roster;
  const {
    activeCloudOrgId,
    activeOrgId,
    activeProjectOrgId,
    manageableCloudOrg,
    manageableLocalOrg,
    orgSelectorLoading,
    orgSelectorOptions,
    setSelectedOrgId,
    groupByMode,
    setGroupByMode,
    groupVisibleCount,
    setGroupVisibleCount,
    includeExternal,
    setIncludeExternal,
    cloudMyPaginationScopeKey,
    cloudMySessionsVisibleCount,
    setCloudMyPagination,
    resetCloudMyPagination,
    cloudSignedInAvatarUrl,
    cloudSignedInIdentity,
    handleCloudSignIn,
  } = scope;
  const {
    newSessionLabel,
    pinFolderLabel,
    unpinFolderLabel,
    createProjectLabel,
    createWorkItemLabel,
    runtimeLabel,
    teamInboxLabel,
    importGithubIssuesLabel,
    addOrgLabel,
    manageOrgLabel,
  } = buildWorkstationSidebarLabels({ t, tProjects, tSessions, tCommon });

  const {
    cloudMenuItems,
    cloudSessionMenuItems,
    channelMenuItems,
    selectedCloudMenuItemId,
    handleCloudSessionItemClick,
    resetCloudTeamPagination,
    buildCloudRemoteItemMenuItems,
    cloudRemoteRowMap,
    cloudRemoteViewerMap,
    cloudChannelsDialogs,
    localChannelsDialogs,
  } = useWorkstationSidebarCloudMenuData({ activeCloudOrgId, cloudSection });

  const {
    menuItems,
    sessionMap,
    subagentParentIds,
    isLoadMoreId,
    getLoadMoreGroupId,
  } = projection;

  const {
    rename,
    activeChatPanelTab,
    highlightedSessionId,
    pinnedMenuItems,
    sessionSidebarMenuItems,
    loadedCloudMySessionRowCount,
    revealCandidateMenuItems,
  } = useWorkstationSidebarPinnedAndRevealData({
    activeSessionId,
    cloudMenuItems,
    menuItems,
    sessionCreatorDrafts,
    activeViewKey,
    sessionSearchLabel: t("sidebar.search.sessions"),
    sessionRefreshLabel: tCommon("actions.refresh"),
    sessionRefreshIconClassName: refreshSpinClass,
    onSessionSearch: openAgentSessionSearchSpotlight,
    onSessionRefresh: handleRefreshSessions,
    createProjectLabel,
    createWorkItemLabel,
    importGithubIssuesLabel,
    newSessionLabel,
    runtimeLabel,
    teamInboxLabel,
    teamInboxUnreadCount,
    t,
    tSessions,
  });

  const { activateMyStationRouteForProjectTabContent, handleGoToNewSession } =
    useSidebarStationNavigation({
      setStationMode,
      setStationChatVisible,
      openStartPageTab,
      resetChatPanelSessionSurface,
      setChatPanelCreateTarget,
      goToNewSession,
      location,
      navigate,
      t,
    });

  const {
    handleDeleteSession,
    handleExportMarkdown,
    handleMenuItemClick,
    handleTogglePin,
    handleOpenInNewTab,
    handleOpenInMyStation,
    handleOpenInNewWindow,
    handleToggleSubagentExpansion,
  } = useWorkstationSidebarSessionInteractionHandlers({
    handleCloudSessionItemClick,
    cloudMySessionsVisibleCount,
    cloudMyPaginationScopeKey,
    setCloudMyPagination,
    loadedCloudMySessionRowCount,
    sessionPagination,
    activeSessionId,
    sessionMap,
    isLoadMoreId,
    getLoadMoreGroupId,
    sessionRouteLabel: t("routes.session"),
    handleGoToNewSession,
    navigateTo,
    openSession,
    promoteActiveSessionCreatorDraft,
    groupByMode,
    defaultGroupVisibleCount: groupVisibleCount,
    setGroupVisibleCounts,
    tCommon,
    activateChatPanelTab,
    openOrReplaceSessionInChatPanelTab,
    closeAndDestroyChatPanelTab,
    activateMyStationRouteForProjectTabContent,
    resetChatPanelSessionSurface,
    openSessionInNewChatTab,
    openSessionInWorkstation,
    openSessionInNewWindow,
    setExpandedSubagentParentIds,
  });

  const {
    moveToOrg,
    cloudSyncLevel,
    cloudShare,
    handleMenuItemContextMenu,
    menuItems: sessionMenuItems,
  } = useSessionSidebarRowActions({
    sectionMenuItems: customSections.menuForSession,
    sessionMap,
    rename,
    handleDeleteSession,
    deleteSessionCreatorDraft,
    handleOpenDraftInNewTab: (item) =>
      handleMenuItemClick(item.key, item, "new-tab"),
    handleExportMarkdown,
    handleOpenInNewTab,
    handleOpenInNewWindow,
    handleOpenInMyStation,
    handleTogglePin,
    handleToggleSubagentExpansion,
    buildCloudRemoteItemMenuItems,
    t,
    tCommon,
    expandedSubagentParentIds,
    pinFolderLabel,
    unpinFolderLabel,
    subagentParentIds,
    cloudSessionMenuItems,
    sessionSidebarMenuItems,
    cloudMySessionsVisibleCount,
  });

  const workItems = useWorkItemsSidebarSurface({
    enabled: workItemsContentVisible,
    activeProjectOrgId,
    activateMyStationRouteForProjectTabContent,
  });
  const { selectedMenuItemId, handleSessionCollapsedSectionIdsChange } =
    useWorkstationSidebarSelectionAndCollapse({
      activeSessionCreatorDraftId,
      highlightedSessionId,
      activeViewKey,
      activeChatPanelTabType: activeChatPanelTab?.type ?? null,
      chatPanelContentMode,
      chatPanelCreateTarget,
      chatPanelSelectedProject,
      chatPanelSelectedWorkItem,
      projectsSelectedMenuItemId: workItems.selectedMenuItemId,
      sessionCreatorDrafts,
      activeWorkManagementSection,
      workManagementProjectsView,
      setGroupVisibleCounts,
      collapsedSectionIds,
      groupByMode,
      resetCloudTeamPagination,
      resetCloudMyPagination,
      setCollapsedSectionIds,
    });

  const {
    sidebarScrollLayout,
    resolvedCollapsedSectionIds,
    resolvedOnCollapsedSectionIdsChange,
    resolvedSidebarMenuItems: sidebarMenuItems,
  } = useWorkstationSidebarSectionPresentation({
    activeViewKey,
    pinnedMenuItems,
    workItemsMenuItems: workItems.menuItems,
    channelMenuItems,
    sessionMenuItems,
    workItemsContentVisible,
    workItemsCollapsedSectionIds: workItems.collapsedSectionIds,
    collapsedSectionIds,
    customSectionHeaders: customSections.headers,
    setSavedCustomCollapsed,
    handleSessionCollapsedSectionIdsChange,
  });

  useWorkstationSidebarRevealNavigationEffects({
    sessionSidebarRevealRequest,
    setSidebarCollapsed,
    setActiveViewKey,
    setSelectedOrgId,
    setExpandedSubagentParentIds,
    activeSessionSidebarRevealRequest,
    revealCandidateMenuItems,
    setCollapsedSectionIds,
  });

  const {
    sidebarOrgSelector,
    resolvedMenuItemClick,
    resolvedMenuItemContextMenu,
    resolvedRenderMenuItemWrapper,
  } = useWorkstationSidebarChrome({
    activeOrgId,
    orgSelectorOptions,
    orgSelectorLoading,
    addOrgLabel,
    cloudSignedIn: cloudSignedInIdentity !== null,
    manageOrgLabel,
    handleCloudSignIn: () => void handleCloudSignIn().catch(() => undefined),
    activeViewKey,
    handleMenuItemContextMenu,
    activateMyStationRouteForProjectTabContent,
    t,
    setSelectedOrgId,
    activeCloudOrgId,
    manageableCloudOrg,
    manageableLocalOrg,
    openOrganizationTab,
    sessionMap,
    cloudRemoteRowMap,
    cloudRemoteViewerMap,
    tSessions,
    setWorkManagementProjectsView,
    openWorkManagementTab,
    openRuntimeTab,
    runtimeLabel,
    openTeamInboxTab,
    activateChatPanelTab,
    handleMenuItemClick,
    handleProjectsMenuItemClick: workItems.onMenuItemClick,
    handleOpenInNewTab,
    closeOtherThanActiveChatPanelTabs,
    tCommon,
  });

  const { isLoading, sidebarBottomRightActions, resolvedSelectedMenuItemId } =
    useWorkstationSidebarBottomActions({
      sidebarMenuItems,
      resolvedOnCollapsedSectionIdsChange,
      sessions,
      activeViewKey,
      projectsWorkItemsLoading: workItems.loading,
      projectsSidebarMenuItems: workItems.menuItems,
      sessionsLoading,
      handleRefreshSessions,
      openRuntimeTab,
      runtimeLabel,
      groupByMode,
      groupVisibleCount,
      includeExternal,
      setGroupByMode,
      setGroupVisibleCount,
      setIncludeExternal,
      setGroupVisibleCounts,
      resetCloudTeamPagination,
      resetCloudMyPagination,
      selectedCloudMenuItemId,
      selectedMenuItemId,
      activeSessionId,
      collapsedSectionIds,
      pinnedMenuItems,
    });

  const ordering = useSessionSidebarOrdering({
    enabled: activeViewKey === "sessions",
    items: sidebarMenuItems,
    sessionMap,
    onTogglePin: handleTogglePin,
    onMoveToSection: customSections.moveToSection,
    sectionMembership: customSections.membership,
  });
  const wrapOrderedRow = ordering.wrap;
  const renderOrderedMenuItem = useCallback(
    (
      item: Parameters<NonNullable<typeof resolvedRenderMenuItemWrapper>>[0],
      node: React.ReactElement
    ) =>
      wrapOrderedRow(
        item,
        resolvedRenderMenuItemWrapper
          ? resolvedRenderMenuItemWrapper(item, node)
          : node
      ),
    [wrapOrderedRow, resolvedRenderMenuItemWrapper]
  );

  return (
    <>
      <NavigationSidebar
        menuItems={sidebarScrollLayout.menuItems}
        pinnedMenuItems={sidebarScrollLayout.pinnedMenuItems}
        selectedKey={resolvedSelectedMenuItemId}
        onMenuItemClick={(key, item, ...args) => {
          if (!customSections.handlePageClick(item.id))
            resolvedMenuItemClick(key, item, ...args);
        }}
        onMenuItemContextMenu={resolvedMenuItemContextMenu}
        renderMenuItemWrapper={renderOrderedMenuItem}
        topBarFollowingContent={
          <div className="shrink-0 px-3 pt-1">{sidebarOrgSelector}</div>
        }
        preListContent={
          <SessionSidebarViewSwitcher
            activeKey={activeViewKey}
            onChange={setActiveViewKey}
          />
        }
        listTopPadding={activeViewKey === "sessions" ? "row" : true}
        bottomContent={
          <>
            {ordering.unpinDropZone}
            <SidebarBottomBar
              leftContent={
                <SidebarSettingsMenuButton
                  onSignIn={
                    cloudSignedInIdentity === null
                      ? handleCloudSignIn
                      : undefined
                  }
                  renderTrigger={({ isOpen, onClick }) => (
                    <SidebarAccountButton
                      identity={cloudSignedInIdentity}
                      avatarUrl={cloudSignedInAvatarUrl}
                      menuOpen={isOpen}
                      onClick={onClick}
                    />
                  )}
                />
              }
              rightActions={sidebarBottomRightActions}
            />
          </>
        }
        isLoading={isLoading}
        collapsibleSections
        collapsedSectionIds={resolvedCollapsedSectionIds}
        onCollapsedSectionsChange={resolvedOnCollapsedSectionIdsChange}
        revealMenuItemRequest={
          activeSessionSidebarRevealRequest
            ? {
                key:
                  activeSessionSidebarRevealRequest.sidebarItemId ??
                  activeSessionSidebarRevealRequest.sessionId,
                requestId: activeSessionSidebarRevealRequest.requestId,
              }
            : undefined
        }
      />
      {ordering.insertionLine}
      <SidebarDialogs
        cloudChannelsDialogs={cloudChannelsDialogs}
        localChannelsDialogs={localChannelsDialogs}
        cloudMemberFilterDropdown={null}
        cloudShare={cloudShare}
        cloudSyncLevel={cloudSyncLevel}
        moveToOrg={moveToOrg}
        rename={rename}
        sessionMap={sessionMap}
      />
    </>
  );
};

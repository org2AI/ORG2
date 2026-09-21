import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import Message from "@src/components/Message";
import { ROUTES } from "@src/config/routes";
import { useAppNavigate as useNavigate } from "@src/hooks/navigation/useAppNavigate";
import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import {
  sessionCreatorDraftListAtom,
  sessionLoadingAtom,
  sessionsAtom,
  visitedSessionsAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import {
  clearSessionSidebarRevealAtom,
  sessionSidebarRevealRequestAtom,
} from "@src/store/ui/sidebarAtom";

import { sidebarCustomCollapsedAtom } from "../sections/collapsePreference";
import { useSidebarSections } from "../sections/useSidebarSections";
import type { SidebarTabDisposition } from "../sidebarTabNavigation";
import { useSessionMenuItems } from "../useSessionMenuItems/index";
import { DEFAULT_COLLAPSED_SECTION_IDS } from "../workstationSidebarData";
import { buildCloudScopedMenuItems } from "./cloudScopedMenuItems";
import { useCloudSessionsSection } from "./cloudSessionsSection";
import { openNewChatFromSidebar } from "./sessionEntryActions";
import { useWorkstationSidebarChatPanelAtoms } from "./sidebarConnector.chatPanelAtoms";
import { buildWorkstationSidebarLabels } from "./sidebarConnector.labels";
import { useWorkstationSidebarRevealRequestState } from "./sidebarConnector.revealRequestState";
import { useWorkstationSidebarScopeAndPagination } from "./sidebarConnector.scopeAndPagination";
import { useSessionSidebarMenuItems } from "./sidebarMenuCollections";
import { useMobileSidebarSessions } from "./useMobileSidebarSessions";
import { useSidebarRosterViewState } from "./useSidebarRosterViewState";
import { useWorkspaceGroupActions } from "./useWorkspaceGroupActions";

const noop = () => undefined;

/** Application-owned data; visual sidebars, channels and work-item views remain demand-driven. */
function useDesktopSessionRosterState() {
  const [visualConsumers, setVisualConsumers] = useState(0);
  const registerView = useCallback(() => {
    setVisualConsumers((count) => count + 1);
    return () => setVisualConsumers((count) => count - 1);
  }, []);
  const { t } = useTranslation("navigation");
  const { t: tProjects } = useTranslation("projects");
  const { t: tSessions } = useTranslation("sessions");
  const { t: tCommonRaw } = useTranslation();
  const tCommon = useCallback(
    (key: string, defaultValue?: string) => tCommonRaw(key, { defaultValue }),
    [tCommonRaw]
  );
  const sessions = useAtomValue(sessionsAtom);
  const sessionsLoading = useAtomValue(sessionLoadingAtom);
  const visitedSessions = useAtomValue(visitedSessionsAtom);
  const sessionCreatorDrafts = useAtomValue(sessionCreatorDraftListAtom);
  const activeSessionId = useAtomValue(workstationActiveSessionIdAtom) ?? "";
  const sessionSidebarRevealRequest = useAtomValue(
    sessionSidebarRevealRequestAtom
  );
  const clearSessionSidebarReveal = useSetAtom(clearSessionSidebarRevealAtom);
  const scope = useWorkstationSidebarScopeAndPagination({ sessions });
  const {
    activeCloudOrgId,
    activeOrgId,
    sortedSessions,
    groupByMode,
    groupVisibleCount,
    includeExternal,
    repoPathToName,
    sessionFilterOrgIds,
    orgSelectorLoading,
    cloudSessionFilter,
    cloudMySessionsVisibleCount,
    handleCloudSessionFilterChange,
    personalHiddenCloudTaggedIds,
    cloudTaggedSessionIds,
  } = scope;
  const {
    groupVisibleCounts,
    setGroupVisibleCounts,
    expandedSubagentParentIds,
    setExpandedSubagentParentIds,
  } = useSidebarRosterViewState(activeOrgId, sortedSessions);
  const [savedCustomCollapsed, setSavedCustomCollapsed] = useAtom(
    sidebarCustomCollapsedAtom
  );
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(
    () => new Set([...DEFAULT_COLLAPSED_SECTION_IDS, ...savedCustomCollapsed])
  );
  const customSections = useSidebarSections(
    !activeCloudOrgId,
    collapsedSectionIds
  );
  const { activeSessionSidebarRevealRequest, revealedSessionIds } =
    useWorkstationSidebarRevealRequestState({
      sessionSidebarRevealRequest,
      activeSessionId,
      clearSessionSidebarReveal,
    });
  const labels = buildWorkstationSidebarLabels({
    t,
    tProjects,
    tSessions,
    tCommon,
  });
  const location = useLocation();
  const navigate = useNavigate();
  const { goToNewSession } = useAppNavigation();
  const {
    resetChatPanelSessionSurface,
    setChatPanelCreateTarget,
    openStartPageTab,
    setStationMode,
    setStationChatVisible,
    openSessionInNewWindow,
    openSessionInNewChatTab,
    openOrReplaceSessionInChatPanelTab,
    closeOtherThanActiveChatPanelTabs,
    openSessionInWorkstation,
  } = useWorkstationSidebarChatPanelAtoms();
  const openNewSession = useCallback(
    () =>
      openNewChatFromSidebar({
        goToNewSession,
        resetChatPanelSessionSurface,
        openNewChatTab: () =>
          openStartPageTab({ title: t("routes.launchpad") }),
        setChatPanelCreateTarget,
      }),
    [
      goToNewSession,
      resetChatPanelSessionSurface,
      openStartPageTab,
      setChatPanelCreateTarget,
      t,
    ]
  );
  const workspaceGroupActions = useWorkspaceGroupActions({
    createSessionLabel: labels.newSessionLabel,
    moreActionsLabel: labels.moreActionsLabel,
    pinLabel: labels.pinWorkspaceLabel,
    unpinLabel: labels.unpinWorkspaceLabel,
    hideLabel: labels.hideWorkspaceLabel,
    unhideLabel: labels.unhideWorkspaceLabel,
    revealLabel: labels.revealWorkspaceLabel,
    unavailableTitle: labels.workspaceUnavailableTitle,
    unavailableMessage: labels.workspaceUnavailableMessage,
    openNewSession,
    setCollapsedSectionIds,
  });
  const openCloudSessionAtDestination = useCallback(
    (
      destination: SidebarTabDisposition | "my-station" | "new-window",
      options: { sessionId: string; title: string }
    ) => {
      if (destination === "new-window") {
        void openSessionInNewWindow(options).catch((error) => {
          Message.error(error instanceof Error ? error.message : String(error));
        });
        return;
      }

      setStationMode("my-station");
      setStationChatVisible("my-station", true);
      if (location.pathname !== ROUTES.workStation.code.path) {
        navigate(ROUTES.workStation.code.path);
      }

      if (destination === "new-tab") {
        resetChatPanelSessionSurface();
        openSessionInNewChatTab({
          sessionId: options.sessionId,
          sessionName: options.title,
        });
        return;
      }

      if (destination === "default" || destination === "replace-all") {
        resetChatPanelSessionSurface();
        openOrReplaceSessionInChatPanelTab({
          sessionId: options.sessionId,
          sessionName: options.title,
        });
        if (destination === "replace-all") {
          void closeOtherThanActiveChatPanelTabs().catch((error) => {
            Message.error(
              error instanceof Error ? error.message : String(error)
            );
          });
        }
        return;
      }

      openSessionInWorkstation({
        sessionId: options.sessionId,
        title: options.title,
      });
    },
    [
      location.pathname,
      navigate,
      resetChatPanelSessionSurface,
      openSessionInNewChatTab,
      openSessionInNewWindow,
      openSessionInWorkstation,
      openOrReplaceSessionInChatPanelTab,
      closeOtherThanActiveChatPanelTabs,
      setStationChatVisible,
      setStationMode,
    ]
  );

  const cloudSection = useCloudSessionsSection({
    orgId: activeCloudOrgId,
    sessions,
    filter: cloudSessionFilter,
    activeSessionId,
    localSessionHydrationLimit: cloudMySessionsVisibleCount,
    groupVisibleCount,
    revealedMenuItemId:
      activeSessionSidebarRevealRequest?.cloudOrgId === activeCloudOrgId
        ? activeSessionSidebarRevealRequest?.sidebarItemId
        : undefined,
    openSessionAtDestination: openCloudSessionAtDestination,
    onFilterChange: handleCloudSessionFilterChange,
  });
  const { cloudFlatListExcludedSessionIds, cloudLocalSessionIds } =
    cloudSection;
  const excludedSessionIds = useMemo(
    () =>
      personalHiddenCloudTaggedIds
        ? new Set([
            ...cloudFlatListExcludedSessionIds,
            ...personalHiddenCloudTaggedIds,
          ])
        : cloudFlatListExcludedSessionIds,
    [cloudFlatListExcludedSessionIds, personalHiddenCloudTaggedIds]
  );
  const extraSessionIds = useMemo(
    () =>
      activeCloudOrgId && cloudLocalSessionIds.size > 0
        ? new Set([...(cloudTaggedSessionIds ?? []), ...cloudLocalSessionIds])
        : cloudTaggedSessionIds,
    [activeCloudOrgId, cloudLocalSessionIds, cloudTaggedSessionIds]
  );
  const projection = useSessionMenuItems({
    enrichVisibleRows: visualConsumers > 0,
    customSections,
    sortedSessions,
    visitedSessions,
    repoPathToName,
    groupByMode,
    untitledSession: labels.untitledSession,
    selectedOrgIds: sessionFilterOrgIds,
    extraSessionIds,
    excludedSessionIds,
    includeExternal,
    groupVisibleCounts,
    defaultGroupVisibleCount: groupVisibleCount,
    showAllLoadedGroupSessions: Boolean(activeCloudOrgId),
    expandedSubagentParentIds,
    revealedSessionIds,
    workspaceGroupActions,
  });
  // Use the same draft/pinned placement and cloud My Sessions paging as visual connectors.
  // Action callbacks are irrelevant to this serialization; no controls are rendered.
  const sessionItems = useSessionSidebarMenuItems({
    menuItems: projection.menuItems,
    sessionCreatorDrafts,
    searchLabel: "",
    refreshLabel: "",
    onSearch: noop,
    onRefresh: noop,
    t,
  });
  const mobileItems = useMemo(
    () =>
      buildCloudScopedMenuItems({
        cloudMenuItems: cloudSection.cloudMenuItems,
        sessionMenuItems: sessionItems,
        mySessionsLabel: t("cloud.sidebar.mySessions"),
        mySessionsVisibleCount: cloudMySessionsVisibleCount,
      }),
    [cloudSection.cloudMenuItems, sessionItems, t, cloudMySessionsVisibleCount]
  );
  useMobileSidebarSessions({
    scope: activeOrgId,
    loading: sessionsLoading || orgSelectorLoading,
    items: mobileItems,
    sessionMap: projection.sessionMap,
    repoPathToName,
  });
  return {
    registerView,
    scope,
    customSections,
    projection,
    cloudSection,
    groupVisibleCounts,
    setGroupVisibleCounts,
    expandedSubagentParentIds,
    setExpandedSubagentParentIds,
    savedCustomCollapsed,
    setSavedCustomCollapsed,
    collapsedSectionIds,
    setCollapsedSectionIds,
    activeSessionSidebarRevealRequest,
  };
}

const DesktopSessionRosterContext = createContext<ReturnType<
  typeof useDesktopSessionRosterState
> | null>(null);

/** Mount once above route and hover-sidebar render gates. */
export function DesktopSessionRosterProvider({
  children,
}: React.PropsWithChildren) {
  const roster = useDesktopSessionRosterState();
  return (
    <DesktopSessionRosterContext.Provider value={roster}>
      {children}
      {/* These shared controllers must render their active overlay once, not per sidebar view. */}
      {roster.customSections.dialog}
      {roster.cloudSection.cloudMemberFilterDropdown}
    </DesktopSessionRosterContext.Provider>
  );
}

export function useDesktopSessionRoster() {
  const roster = useContext(DesktopSessionRosterContext);
  const registerView = roster?.registerView;
  useEffect(() => registerView?.(), [registerView]);
  if (!roster) throw new Error("Desktop session roster owner is missing");
  return roster;
}

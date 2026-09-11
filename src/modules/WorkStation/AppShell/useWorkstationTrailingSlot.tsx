/**
 * useWorkstationTrailingSlot
 *
 * Builds the trailing-slot ReactNode for WorkstationTabBar.
 * Extracted to isolate the complex conditional rendering logic
 * (Plus menu, Chat Panel toggle, Minimize/Restore control,
 * Project trailing bar) from the
 * main tab-bar component.
 */
import { useAtomValue } from "jotai";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import { CHROME_TOOLTIP_HOVER_DELAY } from "@src/config/tooltip";
import { usePinnedWorkbenchChromeVisible } from "@src/hooks/ui/workbench/usePinnedWorkbenchChrome";
import { Cancel01Icon, HugeiconsIcon } from "@src/icons";
import ProjectManagerWorkItemsTabBarTrailing from "@src/modules/ProjectManager/ProjectManagerLayout/components/ProjectManagerWorkItemsTabBarTrailing";
import { TabBarPlusMenu } from "@src/modules/WorkStation/AppShell/TabBarPlusMenu";
import { activeStationChatVisibleAtom } from "@src/store/ui/chatPanel/visibilityAtoms";
import { chatWidthAtom } from "@src/store/ui/chatPanel/widthAtoms";
import { chatPanelPositionAtom } from "@src/store/ui/workStationLayout/chatPositionAtoms";
import { workstationProjectTabBarAtom } from "@src/store/workstation";
import type { WorkstationTabHost } from "@src/store/workstation/tabHost";

import {
  StationChatVisibilityButton,
  StationMaximizeChatButton,
  useStationPaneActions,
} from "../shared/StationPaneControls";
import type { UseWorkstationTabListReturn } from "./useWorkstationTabList";

export interface UseWorkstationTrailingSlotOptions {
  host: WorkstationTabHost;
  visible: UseWorkstationTabListReturn["visible"];
}

export interface UseWorkstationTrailingSlotReturn {
  trailingSlot: ReactNode;
  handleToggleChatPanel: () => void;
}

export function useWorkstationTrailingSlot({
  host,
  visible,
}: UseWorkstationTrailingSlotOptions): UseWorkstationTrailingSlotReturn {
  const { t } = useTranslation(["sessions", "common", "settings"]);
  const location = useLocation();
  const getStationChatVisible = useAtomValue(activeStationChatVisibleAtom);
  const chatWidth = useAtomValue(chatWidthAtom);
  const chatPanelPosition = useAtomValue(chatPanelPositionAtom);
  const projectTabBar = useAtomValue(workstationProjectTabBarAtom);
  const pinnedChrome = usePinnedWorkbenchChromeVisible();

  const isChatPanelVisible =
    getStationChatVisible("my-station") && chatWidth > 0;
  // Settings occupies the chat-panel slot; SettingsSlot owns its own
  // maximize/restore button, so the workstation-side toggle is redundant
  // and visually conflicting (two buttons driving the same atom).
  const isSettingsRoute = location.pathname.startsWith("/orgii/app/settings");
  const showPaneControls = !isSettingsRoute && !pinnedChrome;

  const { handleToggleChatPanel, handleToggleChatPanelMaximized } =
    useStationPaneActions();

  const trailingSlot = useMemo((): ReactNode => {
    // Unified surface: the "+" (new-tab) menu always renders. There are no
    // per-app surfaces left to gate it on — from anywhere you can open any
    // tab type.
    const plusMenuControl = <TabBarPlusMenu />;

    const chatPanelControl = showPaneControls ? (
      <StationChatVisibilityButton
        visible={isChatPanelVisible}
        onClick={handleToggleChatPanel}
      />
    ) : null;
    const maximizeChatControl =
      showPaneControls && isChatPanelVisible ? (
        <StationMaximizeChatButton
          chatPanelPosition={chatPanelPosition}
          onClick={handleToggleChatPanelMaximized}
        />
      ) : null;
    const shrinkWorkstationControl =
      showPaneControls && !isChatPanelVisible ? (
        <StationChatVisibilityButton
          visible={false}
          restoreIcon="shrink"
          onClick={handleToggleChatPanel}
        />
      ) : null;

    // X close button shown only while the Settings slot is mounted:
    // hides the workstation surface and maximizes Settings. The
    // SettingsSlot's own Maximize2 button performs the same toggle from
    // the opposite side, so dismissing the workstation is reachable from
    // wherever the user's pointer currently is.
    const maximizeSettingsLabel = t("settings:panel.maximizeSettings");
    const closeWorkstationControl = isSettingsRoute ? (
      <TabBarTrailingIconButton
        title={maximizeSettingsLabel}
        shortcutId="maximize_chat"
        tooltipMouseEnterDelay={CHROME_TOOLTIP_HOVER_DELAY}
        onClick={handleToggleChatPanelMaximized}
      >
        <HugeiconsIcon
          icon={Cancel01Icon}
          data-icon="x"
          size={14}
          strokeWidth={2}
        />
      </TabBarTrailingIconButton>
    ) : null;

    let projectTrailingControl: ReactNode = null;
    if (host === "project" && projectTabBar) {
      const activeRawId =
        visible.find((entry) => entry.isActive)?.tab.id ??
        visible[0]?.tab.id ??
        null;
      projectTrailingControl = (
        <ProjectManagerWorkItemsTabBarTrailing
          activeTabId={activeRawId}
          onAddProject={projectTabBar.onAddProject}
        />
      );
    }

    return (
      <>
        {plusMenuControl}
        {projectTrailingControl}
        {shrinkWorkstationControl}
        {chatPanelControl}
        {maximizeChatControl}
        {closeWorkstationControl}
      </>
    );
  }, [
    host,
    handleToggleChatPanel,
    handleToggleChatPanelMaximized,
    isChatPanelVisible,
    isSettingsRoute,
    showPaneControls,
    projectTabBar,
    t,
    visible,
    chatPanelPosition,
  ]);

  return { trailingSlot, handleToggleChatPanel };
}

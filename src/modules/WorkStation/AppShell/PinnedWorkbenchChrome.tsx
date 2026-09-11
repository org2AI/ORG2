/**
 * PinnedWorkbenchChrome
 *
 * macOS only. While the active station is empty, the window's right-edge
 * collapse toggles — hide / restore the chat pane, and maximize chat / show
 * workstation — are drawn once in window coordinates. Populated stations
 * leave this group hidden so their pane-owned trailing controls cannot be
 * covered. The counterpart of `PinnedSidebarChrome` on the left.
 */
import { useAtomValue, useSetAtom } from "jotai";
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import { CHROME_TOOLTIP_HOVER_DELAY } from "@src/config/tooltip";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import {
  PINNED_WORKBENCH_CHROME_CENTER_TOP,
  PINNED_WORKBENCH_CHROME_RIGHT_INSET,
  useCurrentStationChatVisible,
  usePinnedWorkbenchChromeVisible,
} from "@src/hooks/ui/workbench/usePinnedWorkbenchChrome";
import {
  HugeiconsIcon,
  LayoutAlignRightIcon,
  PanelRightIcon,
  PanelRightOpenIcon,
} from "@src/icons";
import { effectiveChatPanelMaximizedAtom } from "@src/store/chatPanel/chatPanelLayoutAtoms";
import { toggleActiveChatPanelMaximizedAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import { isChatPanelTabStationAvailable } from "@src/store/chatPanel/chatPanelTabsModel";
import { activeChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { chatPanelPositionAtom } from "@src/store/ui/workStationLayout/chatPositionAtoms";

import {
  StationChatVisibilityButton,
  StationMaximizeChatButton,
  useStationPaneActions,
} from "../shared/StationPaneControls";

const PinnedWorkbenchChromeComponent: React.FC = () => {
  const { t } = useTranslation("sessions");
  const visible = usePinnedWorkbenchChromeVisible();
  const isChatPanelVisible = useCurrentStationChatVisible();
  const chatPanelPosition = useAtomValue(chatPanelPositionAtom);
  const activeTab = useAtomValue(activeChatPanelTabAtom);
  const chatPanelMaximized = useAtomValue(effectiveChatPanelMaximizedAtom);
  const toggleActiveChatMaximized = useSetAtom(
    toggleActiveChatPanelMaximizedAtom
  );

  const { handleToggleChatPanel, handleToggleChatPanelMaximized } =
    useStationPaneActions();
  const handleShowWorkstation = useCallback(() => {
    toggleActiveChatMaximized();
  }, [toggleActiveChatMaximized]);

  if (!visible) return null;

  const stationAvailable = isChatPanelTabStationAvailable(activeTab);

  // Slot A: hide / restore the chat pane. Meaningless while the chat is
  // maximized (there is no workstation to grow), so it is dropped outright.
  const chatVisibilityControl = chatPanelMaximized ? null : (
    <StationChatVisibilityButton
      visible={isChatPanelVisible}
      onClick={handleToggleChatPanel}
      testId="pinned-workbench-chrome-chat-visibility"
    />
  );

  // Slot B: maximize chat while the workstation shows; show the workstation
  // again while the chat is maximized. Nothing to draw while the chat is
  // hidden — no spacer either, so the restore toggle sits flush right and
  // the host reserves for one slot (`useWorkbenchRightEdgeReservation`).
  let maximizeControl: React.ReactNode;
  if (!isChatPanelVisible) {
    maximizeControl = null;
  } else if (chatPanelMaximized) {
    maximizeControl = (
      <TabBarTrailingIconButton
        title={
          stationAvailable
            ? t("chat.showWorkstation")
            : t("chat.workstationUnavailableForPage")
        }
        shortcutId={stationAvailable ? "maximize_chat" : undefined}
        tooltipMouseEnterDelay={CHROME_TOOLTIP_HOVER_DELAY}
        nativeTitle={false}
        onClick={stationAvailable ? handleShowWorkstation : undefined}
        disabled={!stationAvailable}
        className="group"
        data-testid="pinned-workbench-chrome-show-workstation"
      >
        <span className="flex h-4 w-4 items-center justify-center">
          <HugeiconsIcon
            icon={
              chatPanelPosition === "left"
                ? LayoutAlignRightIcon
                : PanelRightIcon
            }
            data-icon={
              chatPanelPosition === "left"
                ? "layout-align-right"
                : "panel-right"
            }
            size={HEADER_ICON_SIZE.md}
            strokeWidth={1.75}
            className="group-hover:hidden"
          />
          <HugeiconsIcon
            icon={
              chatPanelPosition === "left" ? PanelRightIcon : PanelRightOpenIcon
            }
            data-icon={
              chatPanelPosition === "left" ? "panel-right" : "panel-right-open"
            }
            size={HEADER_ICON_SIZE.md}
            strokeWidth={1.75}
            className="hidden group-hover:block"
          />
        </span>
      </TabBarTrailingIconButton>
    );
  } else {
    maximizeControl = (
      <StationMaximizeChatButton
        chatPanelPosition={chatPanelPosition}
        onClick={handleToggleChatPanelMaximized}
        testId="pinned-workbench-chrome-maximize-chat"
      />
    );
  }

  return (
    <div
      className="fixed z-[10000] flex -translate-y-1/2 items-center gap-px"
      data-testid="pinned-workbench-chrome"
      style={
        {
          right: PINNED_WORKBENCH_CHROME_RIGHT_INSET,
          top: PINNED_WORKBENCH_CHROME_CENTER_TOP,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties
      }
    >
      {chatVisibilityControl}
      {maximizeControl}
    </div>
  );
};

export const PinnedWorkbenchChrome = memo(PinnedWorkbenchChromeComponent);
PinnedWorkbenchChrome.displayName = "PinnedWorkbenchChrome";

/**
 * PinnedWorkbenchChrome
 *
 * macOS only. While the active station is empty, the window's right-edge
 * collapse toggles — hide / restore the chat pane, and maximize chat / show
 * workstation — are drawn once in window coordinates. Populated stations
 * leave this group hidden so their pane-owned trailing controls cannot be
 * covered. The counterpart of `PinnedSidebarChrome` on the left.
 */
import { useAtomValue } from "jotai";
import React, { memo, useSyncExternalStore } from "react";

import {
  PINNED_WORKBENCH_CHROME_CENTER_TOP,
  PINNED_WORKBENCH_CHROME_RIGHT_INSET,
  useCurrentStationChatVisible,
  usePinnedWorkbenchChromeVisible,
} from "@src/hooks/ui/workbench/usePinnedWorkbenchChrome";
import {
  getFindOpen,
  subscribeFind,
} from "@src/scaffold/GlobalSpotlight/FindCard/findCoordinator";
import { effectiveChatPanelMaximizedAtom } from "@src/store/chatPanel/chatPanelLayoutAtoms";
import { chatPanelPositionAtom } from "@src/store/ui/workStationLayout/chatPositionAtoms";

import {
  ChatPaneFocusButton,
  StationPaneControls,
  useStationPaneActions,
} from "./StationPaneControls";

const PinnedWorkbenchChromeComponent: React.FC = () => {
  const visible = usePinnedWorkbenchChromeVisible();
  const findOpen = useSyncExternalStore(subscribeFind, getFindOpen);
  const isChatPanelVisible = useCurrentStationChatVisible();
  const chatPanelPosition = useAtomValue(chatPanelPositionAtom);
  const chatPanelMaximized = useAtomValue(effectiveChatPanelMaximizedAtom);
  const { handleToggleChatPanel, handleToggleChatPanelMaximized } =
    useStationPaneActions();

  // This window-level layer sits above pane-local overlays. Yield while Find
  // is open, without changing the header's reserved width or pane ownership.
  if (!visible || findOpen) return null;

  // The maximized chat owns its show-workstation action. Other states use
  // the same pane-control selection as My Station and Agent Station.
  let paneControls: React.ReactNode;
  if (chatPanelMaximized && isChatPanelVisible) {
    paneControls = (
      <ChatPaneFocusButton
        focused
        chatPanelPosition={chatPanelPosition}
        onClick={handleToggleChatPanelMaximized}
        testId="pinned-workbench-chrome-show-workstation"
      />
    );
  } else {
    paneControls = (
      <StationPaneControls
        chatVisible={isChatPanelVisible}
        chatPanelPosition={chatPanelPosition}
        onToggleChat={handleToggleChatPanel}
        onMaximizeChat={handleToggleChatPanelMaximized}
        visibilityTestId="pinned-workbench-chrome-chat-visibility"
        maximizeTestId="pinned-workbench-chrome-maximize-chat"
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
      {paneControls}
    </div>
  );
};

export const PinnedWorkbenchChrome = memo(PinnedWorkbenchChromeComponent);
PinnedWorkbenchChrome.displayName = "PinnedWorkbenchChrome";

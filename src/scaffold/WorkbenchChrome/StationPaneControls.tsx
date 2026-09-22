import { useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, startTransition, useCallback } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { createLogger } from "@src/hooks/logger";
import {
  ArrowExpand01Icon,
  ArrowShrink02Icon,
  Cancel01Icon,
  ChangeScreenModeIcon,
  HugeiconsIcon,
  LayoutAlignRightIcon,
  PanelRightIcon,
  PanelRightOpenIcon,
} from "@src/icons";
import { WorkStationViewService } from "@src/services/workStation/WorkStationViewService";
import {
  activeChatPanelTabStationAvailableAtom,
  toggleActiveChatPanelMaximizedAtom,
} from "@src/store/chatPanel/chatPanelLayoutAtoms";
import type { ChatPanelPosition } from "@src/store/ui/workStationLayout/chatPositionAtoms";
import { openStationInNewWindowAtom } from "@src/store/workstation/stationWindowAtoms";
import type { StationMode } from "@src/types/ui/workstation";

const logger = createLogger("StationPaneControls");

/** i18n keys of the station display names, used as the window title. */
export const STATION_TITLE_KEY: Record<StationMode, string> = {
  "my-station": "common:terminology.myStation",
  "agent-station": "common:terminology.agentStation",
};

/**
 * Detach the given station into its own OS window. Shared by the station
 * header buttons and the station-mode pill inside a detached window; the
 * atom owns the seed session and the main-window layout follow-up.
 */
export function useOpenStationInNewWindow(): (mode: StationMode) => void {
  const { t } = useTranslation(["common"]);
  const openStationInNewWindow = useSetAtom(openStationInNewWindowAtom);
  return useCallback(
    (mode: StationMode) => {
      openStationInNewWindow({
        stationMode: mode,
        title: t(STATION_TITLE_KEY[mode]),
      }).catch((error: unknown) => {
        logger.error("Failed to open station window:", error);
        Message.error(error instanceof Error ? error.message : String(error));
      });
    },
    [openStationInNewWindow, t]
  );
}

/** Tab-bar trailing control: open this station in a new window. */
export function StationOpenInNewWindowButton({
  stationMode,
  testId,
}: {
  stationMode: StationMode;
  testId?: string;
}) {
  const { t } = useTranslation(["common"]);
  const openStationInNewWindow = useOpenStationInNewWindow();
  const handleClick = useCallback(() => {
    openStationInNewWindow(stationMode);
  }, [openStationInNewWindow, stationMode]);
  return (
    <TabBarTrailingIconButton
      title={t("common:actions.openInNewWindow")}
      onClick={handleClick}
      data-testid={testId}
    >
      <HugeiconsIcon
        icon={ChangeScreenModeIcon}
        data-icon="change-screen-mode"
        size={HEADER_ICON_SIZE.sm}
        strokeWidth={2}
      />
    </TabBarTrailingIconButton>
  );
}

export function useStationPaneActions() {
  const toggleMaximized = useSetAtom(toggleActiveChatPanelMaximizedAtom);
  const handleToggleChatPanel = useCallback(() => {
    startTransition(() => {
      void WorkStationViewService.showWorkStation().catch((error: unknown) => {
        logger.error("Failed to toggle station chat visibility:", error);
      });
    });
  }, []);
  const handleToggleChatPanelMaximized = useCallback(() => {
    toggleMaximized();
  }, [toggleMaximized]);
  return { handleToggleChatPanel, handleToggleChatPanelMaximized };
}

export function WorkstationMaximizeChatIcon({
  chatPanelPosition,
  directionalHover = true,
}: {
  chatPanelPosition: ChatPanelPosition;
  directionalHover?: boolean;
}): ReactNode {
  if (chatPanelPosition === "right") {
    return (
      <HugeiconsIcon
        icon={Cancel01Icon}
        data-icon="x"
        size={HEADER_ICON_SIZE.md}
        strokeWidth={1.75}
      />
    );
  }

  if (!directionalHover) {
    return (
      <HugeiconsIcon
        icon={PanelRightIcon}
        data-icon="panel-right"
        size={HEADER_ICON_SIZE.md}
        strokeWidth={2}
      />
    );
  }

  return (
    <span className="flex h-4 w-4 items-center justify-center">
      <HugeiconsIcon
        icon={PanelRightIcon}
        data-icon="panel-right"
        size={HEADER_ICON_SIZE.md}
        strokeWidth={2}
        className="group-hover:hidden"
      />
      <HugeiconsIcon
        icon={LayoutAlignRightIcon}
        data-icon="layout-align-right"
        size={HEADER_ICON_SIZE.md}
        strokeWidth={2}
        className="hidden group-hover:block"
      />
    </span>
  );
}

export function StationChatVisibilityButton({
  visible,
  onClick,
  testId,
}: {
  visible: boolean;
  onClick: () => void;
  testId?: string;
}) {
  const { t } = useTranslation("sessions");
  return (
    <TabBarTrailingIconButton
      title={
        visible ? t("chat.maximizeWorkStation") : t("chat.restoreChatPanel")
      }
      shortcutId="maximize_work_station"
      onClick={onClick}
      data-testid={testId}
    >
      <HugeiconsIcon
        icon={visible ? ArrowExpand01Icon : ArrowShrink02Icon}
        data-icon={visible ? "maximize-2" : "arrow-shrink-02"}
        size={14}
        strokeWidth={2}
      />
    </TabBarTrailingIconButton>
  );
}

export function StationMaximizeChatButton({
  chatPanelPosition,
  directionalHover = true,
  onClick,
  testId,
}: {
  chatPanelPosition: ChatPanelPosition;
  directionalHover?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  const { t } = useTranslation("sessions");
  return (
    <TabBarTrailingIconButton
      title={t("chat.hideWorkstation")}
      shortcutId="maximize_chat"
      onClick={onClick}
      className={
        directionalHover && chatPanelPosition === "left" ? "group" : undefined
      }
      data-testid={testId}
    >
      <WorkstationMaximizeChatIcon
        chatPanelPosition={chatPanelPosition}
        directionalHover={directionalHover}
      />
    </TabBarTrailingIconButton>
  );
}

/** Resize (expand or restore) plus close; close stays while the station is maximized. */
export function StationPaneControls({
  chatVisible,
  chatPanelPosition,
  onToggleChat,
  onMaximizeChat,
  visibilityTestId,
  maximizeTestId,
}: {
  chatVisible: boolean;
  chatPanelPosition: ChatPanelPosition;
  onToggleChat: () => void;
  onMaximizeChat: () => void;
  visibilityTestId?: string;
  maximizeTestId?: string;
}) {
  return (
    <>
      <StationChatVisibilityButton
        visible={chatVisible}
        onClick={onToggleChat}
        testId={visibilityTestId}
      />
      <StationMaximizeChatButton
        chatPanelPosition={chatPanelPosition}
        directionalHover={false}
        onClick={onMaximizeChat}
        testId={maximizeTestId}
      />
    </>
  );
}

/**
 * Chat-side maximize/restore action, shared with the pinned window chrome.
 * Disabled while the active chat tab owns the whole workbench (Station
 * access "never" — Inbox, Kanban, Runtime, detail pages).
 */
export function ChatPaneFocusButton({
  focused,
  chatPanelPosition,
  onClick,
  testId,
}: {
  focused: boolean;
  chatPanelPosition: ChatPanelPosition;
  onClick: () => void;
  testId?: string;
}) {
  const { t } = useTranslation("sessions");
  const stationAvailable = useAtomValue(activeChatPanelTabStationAvailableAtom);
  let title = t("chat.workstationUnavailableForPage");
  if (stationAvailable) {
    title = t(focused ? "chat.showWorkstation" : "chat.maximizeChatPanel");
  }
  return (
    <TabBarTrailingIconButton
      title={title}
      shortcutId={stationAvailable ? "maximize_chat" : undefined}
      tooltipPosition="bottom-end"
      nativeTitle={false}
      onClick={stationAvailable ? onClick : undefined}
      disabled={!stationAvailable}
      className="group"
      data-testid={testId}
    >
      {focused ? (
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
      ) : (
        <HugeiconsIcon
          icon={ArrowExpand01Icon}
          data-icon="maximize-2"
          size={HEADER_ICON_SIZE.md}
          strokeWidth={1.75}
        />
      )}
    </TabBarTrailingIconButton>
  );
}

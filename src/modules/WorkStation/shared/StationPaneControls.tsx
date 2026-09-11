import { useSetAtom } from "jotai";
import { type ReactNode, startTransition, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import { CHROME_TOOLTIP_HOVER_DELAY } from "@src/config/tooltip";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { createLogger } from "@src/hooks/logger";
import {
  ArrowExpand01Icon,
  ArrowShrink01Icon,
  BubbleChatIcon,
  Cancel01Icon,
  HugeiconsIcon,
  LayoutAlignRightIcon,
  PanelRightIcon,
} from "@src/icons";
import { WorkStationViewService } from "@src/services/workStation/WorkStationViewService";
import { toggleChatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import type { ChatPanelPosition } from "@src/store/ui/workStationLayout/chatPositionAtoms";

const logger = createLogger("StationPaneControls");

export function useStationPaneActions() {
  const toggleMaximized = useSetAtom(toggleChatPanelMaximizedAtom);
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
  restoreIcon = "chat",
  onClick,
  testId,
}: {
  visible: boolean;
  restoreIcon?: "chat" | "shrink";
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
      tooltipMouseEnterDelay={CHROME_TOOLTIP_HOVER_DELAY}
      onClick={onClick}
      data-testid={testId}
    >
      <HugeiconsIcon
        icon={
          visible
            ? ArrowExpand01Icon
            : restoreIcon === "shrink"
              ? ArrowShrink01Icon
              : BubbleChatIcon
        }
        data-icon={
          visible
            ? "maximize-2"
            : restoreIcon === "shrink"
              ? "minimize-2"
              : "message-circle"
        }
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
      tooltipMouseEnterDelay={CHROME_TOOLTIP_HOVER_DELAY}
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

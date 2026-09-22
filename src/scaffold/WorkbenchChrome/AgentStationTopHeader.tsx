/**
 * AgentStationTopHeader
 *
 * Drag-region header bar for the Agent-station variant of AppShell.
 * Contains: station mode chip, chat panel toggle, caption toggle,
 * layout settings dropdown, and a separate caption row below the top bar.
 */
import { useAtom, useAtomValue } from "jotai";
import React, { memo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import { NoDragRegion } from "@src/components/WindowChrome";
import { matchesShortcut } from "@src/config/keyboard/shortcutBindings";
import { TAB_BAR_CONTROLS_ROW_TRAILING_PADDING_PX } from "@src/config/workstation/tokens";
import CaptionBar from "@src/engines/Simulator/components/CaptionBar";
import type { CurrentTurnLastAgentMessage } from "@src/engines/Simulator/hooks/useCurrentTurnLastAgentMessage";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import {
  useCollapsedSidebarChromeOffset,
  useShouldOffsetWorkStationTopBar,
} from "@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset";
import { useWorkbenchRightEdgeReservation } from "@src/hooks/ui/workbench/usePinnedWorkbenchChrome";
import { CaptionsIcon, HugeiconsIcon } from "@src/icons";
import {
  SimulatorAgentChip,
  StationModeChip,
} from "@src/modules/WorkStation/shared";
import { usePaneLayoutInsetTransition } from "@src/scaffold/AppLayout/usePaneLayoutInsetTransition";
import { CollapsedSidebarButton } from "@src/scaffold/NavigationSidebar/CollapsedSidebarButton";
import {
  sessionMapAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import {
  simulatorCaptionBarEnabledAtom,
  simulatorEffectiveDockAppAtom,
} from "@src/store/ui/simulatorAtom";
import { getViewportSize } from "@src/util/ui/window/viewport";

import { StationHeaderControls } from "./StationHeaderControls";

interface AgentStationTopHeaderProps {
  captionMessage: CurrentTurnLastAgentMessage | null;
  captionVisible: boolean;
}

const AgentStationTopHeaderComponent = ({
  captionMessage,
  captionVisible,
}: AgentStationTopHeaderProps) => {
  const { t } = useTranslation("sessions");
  const shouldOffsetLeftChrome = useShouldOffsetWorkStationTopBar();
  const collapsedSidebarChromeOffset = useCollapsedSidebarChromeOffset();
  const rightEdge = useWorkbenchRightEdgeReservation();
  const insetTransitionClassName = usePaneLayoutInsetTransition();
  const effectiveDockApp = useAtomValue(simulatorEffectiveDockAppAtom);
  const [captionEnabled, setCaptionEnabled] = useAtom(
    simulatorCaptionBarEnabledAtom
  );
  const workstationActiveSessionId = useAtomValue(
    workstationActiveSessionIdAtom
  );
  const sessionMap = useAtomValue(sessionMapAtom);
  const activeSession = workstationActiveSessionId
    ? sessionMap.get(workstationActiveSessionId)
    : undefined;
  const captionAgentName = activeSession?.agentDisplayName?.trim() || "Agent";
  const showMessageNotice =
    captionMessage?.isCurrentEvent && effectiveDockApp === AppType.CHANNELS;
  const captionText = showMessageNotice
    ? captionMessage.eventKind === "thought"
      ? t("simulator.thoughtSentMessageCaption", {
          subject: captionAgentName,
        })
      : t(
          captionMessage.source === "user"
            ? "simulator.userSentMessageCaption"
            : "simulator.agentSentMessageCaption",
          { subject: captionAgentName }
        )
    : captionMessage?.text;
  const captionToggleLabel = t("simulator.captionBarToggleTooltip");

  const handleToggleCaption = useCallback(() => {
    setCaptionEnabled((prev) => !prev);
  }, [setCaptionEnabled]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, "toggle_captions")) return;
      event.preventDefault();
      event.stopPropagation();
      handleToggleCaption();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleToggleCaption]);

  const getCaptionPortalBounds = useCallback(() => {
    const { width: vw } = getViewportSize();
    return {
      left: 12,
      right: vw - 12,
    };
  }, []);

  return (
    <div className="flex shrink-0 flex-col">
      <div
        className={`relative flex h-11 min-h-11 shrink-0 items-center pt-2 ${insetTransitionClassName}`}
        data-tauri-drag-region
        style={
          {
            paddingLeft: shouldOffsetLeftChrome
              ? collapsedSidebarChromeOffset
              : undefined,
            // The trailing group keeps its own `pr-2`; only the remainder of
            // the pinned-chrome reservation goes here.
            paddingRight:
              rightEdge.owner === "workstation"
                ? rightEdge.reservedRight -
                  TAB_BAR_CONTROLS_ROW_TRAILING_PADDING_PX
                : undefined,
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
      >
        {shouldOffsetLeftChrome ? (
          <NoDragRegion className="flex h-full items-center">
            <CollapsedSidebarButton />
          </NoDragRegion>
        ) : null}
        <NoDragRegion className="flex h-full min-w-0 items-center gap-1 px-2">
          <StationModeChip />
          <SimulatorAgentChip />
        </NoDragRegion>
        <div className="min-w-0 flex-1" />
        <NoDragRegion className="ml-auto flex h-full shrink-0 items-center gap-px pr-2 pl-1">
          <TabBarTrailingIconButton
            title={captionToggleLabel}
            shortcutId="toggle_captions"
            active={captionEnabled}
            aria-pressed={captionEnabled}
            onClick={handleToggleCaption}
          >
            <HugeiconsIcon
              icon={CaptionsIcon}
              data-icon="captions"
              size={16}
              strokeWidth={2}
            />
          </TabBarTrailingIconButton>
          <StationHeaderControls stationMode="agent-station" />
        </NoDragRegion>
      </div>
      {captionVisible && captionMessage ? (
        <NoDragRegion className="flex h-10 min-h-10 shrink-0 items-center justify-start px-3">
          <div className="w-full min-w-0">
            <CaptionBar
              key={captionMessage.eventId}
              text={captionText ?? captionMessage.text}
              getPortalBounds={getCaptionPortalBounds}
            />
          </div>
        </NoDragRegion>
      ) : null}
    </div>
  );
};

const AgentStationTopHeader = memo(AgentStationTopHeaderComponent);

AgentStationTopHeader.displayName = "AgentStationTopHeader";

export default AgentStationTopHeader;

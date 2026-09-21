/**
 * Header controls of the focused-chat workstation rail: the docked-terminal
 * toggle (expanded trail only) and the collapse / expand chevron.
 */
import { useTranslation } from "react-i18next";

import { WorkstationTrailIconButton } from "@src/components/layout/blocks";
import {
  ArrowLeftDoubleIcon,
  ArrowRightDoubleIcon,
  HugeiconsIcon,
  SquareTerminalIcon,
} from "@src/icons";

import { WORKSTATION_TRAIL_ACTION_REVEAL_CLASS } from "./trailActionReveal";

export function WorkstationTrailHeaderActions({
  collapsed,
  miniTerminalVisible,
  onToggleCollapsed,
  onToggleMiniTerminal,
}: {
  collapsed: boolean;
  miniTerminalVisible: boolean;
  onToggleCollapsed: () => void;
  onToggleMiniTerminal: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {!collapsed ? (
        <WorkstationTrailIconButton
          onClick={onToggleMiniTerminal}
          aria-label={t(
            miniTerminalVisible
              ? "common:git.rail.hideMiniTerminal"
              : "common:git.rail.openMiniTerminal"
          )}
          aria-pressed={miniTerminalVisible}
          title={t(
            miniTerminalVisible
              ? "common:git.rail.hideMiniTerminal"
              : "common:git.rail.openMiniTerminal"
          )}
          className={`${WORKSTATION_TRAIL_ACTION_REVEAL_CLASS} ${miniTerminalVisible ? "bg-fill-2" : ""}`}
        >
          <HugeiconsIcon
            icon={SquareTerminalIcon}
            data-icon="square-terminal"
            size={14}
            strokeWidth={1.75}
          />
        </WorkstationTrailIconButton>
      ) : null}
      <WorkstationTrailIconButton
        size={collapsed ? "small" : "sidebar"}
        className={collapsed ? "" : WORKSTATION_TRAIL_ACTION_REVEAL_CLASS}
        onClick={onToggleCollapsed}
        aria-label={t(
          collapsed ? "common:git.rail.expand" : "common:git.rail.collapse"
        )}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <HugeiconsIcon
            icon={ArrowLeftDoubleIcon}
            data-icon="chevrons-left"
            size={14}
            strokeWidth={1.75}
          />
        ) : (
          <HugeiconsIcon
            icon={ArrowRightDoubleIcon}
            data-icon="chevrons-right"
            size={14}
            strokeWidth={1.75}
          />
        )}
      </WorkstationTrailIconButton>
    </>
  );
}

/**
 * WorkstationSubagentsSubmenu — second-level panel listing every subagent of
 * the active session, opened from the Subagents section's "load more" row.
 * Geometry, scrolling and the filter field live in `WorkstationRailSubmenu`.
 */
import type React from "react";
import { useTranslation } from "react-i18next";

import AnyIcon from "@src/components/AnyIcon";
import { DropdownItem } from "@src/components/Dropdown/exports";
import type { SubmenuAnchor } from "@src/components/Dropdown/submenuLayout";
import { DROPDOWN_ITEM } from "@src/components/Dropdown/tokens";

import { RailItemStatus } from "./RailItemStatus";
import {
  WorkstationRailSubmenuPanel,
  useWorkstationRailSubmenuFilter,
} from "./WorkstationRailSubmenu";
import type {
  FocusedChatRailIcon,
  FocusedChatRailItem,
  FocusedChatRailSubagent,
} from "./types";

/** Map a subagent lifecycle status onto the rail's CI-shaped status chip. */
export function resolveSubagentRowStatus(
  t: (key: string) => string,
  status: FocusedChatRailSubagent["status"]
): NonNullable<FocusedChatRailItem["status"]> {
  const label =
    status === "completed"
      ? t("common:git.rail.subagentCompleted")
      : status === "failed"
        ? t("common:git.rail.subagentFailed")
        : status === "running"
          ? t("common:git.rail.subagentRunning")
          : t("common:git.rail.subagentPending");
  return {
    label,
    state:
      status === "completed"
        ? "success"
        : status === "failed"
          ? "failure"
          : status === "running"
            ? "pending"
            : "checking",
    title: label,
    // The glyph alone marks the row; the localized label stays as the
    // tooltip so five finished rows don't repeat the same word five times.
    iconOnly: true,
  };
}

/** A subagent is found by its task title and by its agent name. */
function subagentSearchText(subagent: FocusedChatRailSubagent): string {
  return `${subagent.description ?? ""} ${subagent.name}`;
}

export function WorkstationSubagentsSubmenu({
  anchor,
  icon,
  maxHeight,
  onClose,
  onOpenSubagent,
  panelRef,
  subagents,
  width,
}: {
  anchor: SubmenuAnchor;
  /** Parent session's harness mark — the same one the preview rows carry. */
  icon: FocusedChatRailIcon;
  /** Height cap; the rows scroll under it. */
  maxHeight: number;
  onClose: () => void;
  onOpenSubagent: (sessionId: string) => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
  subagents: FocusedChatRailSubagent[];
  /** Same width as the list the panel opened from. */
  width: number;
}) {
  const { t } = useTranslation();
  const { query, rows, setQuery, showSearch } = useWorkstationRailSubmenuFilter(
    subagents,
    subagentSearchText
  );

  return (
    <WorkstationRailSubmenuPanel
      anchor={anchor}
      ariaLabel={t("common:git.rail.subagents")}
      emptyLabel={t("common:status.noResults")}
      maxHeight={maxHeight}
      onClose={onClose}
      onSearchChange={setQuery}
      panelRef={panelRef}
      searchValue={query}
      showSearch={showSearch}
      testId="workstation-trail-subagents-submenu"
      width={width}
    >
      {rows.map((subagent) => {
        const label = subagent.description || subagent.name;
        return (
          <DropdownItem
            key={subagent.sessionId}
            role="menuitem"
            icon={
              <AnyIcon
                icon={icon}
                size={DROPDOWN_ITEM.iconSize}
                strokeWidth={1.75}
              />
            }
            suffix={
              <RailItemStatus
                status={resolveSubagentRowStatus(t, subagent.status)}
              />
            }
            onClick={() => onOpenSubagent(subagent.sessionId)}
          >
            <span className="block min-w-0 truncate" title={label}>
              {label}
            </span>
          </DropdownItem>
        );
      })}
    </WorkstationRailSubmenuPanel>
  );
}

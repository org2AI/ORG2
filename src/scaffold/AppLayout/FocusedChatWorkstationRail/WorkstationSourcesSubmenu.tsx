/**
 * WorkstationSourcesSubmenu — second-level panel listing every image and link
 * the user sent in the active session, opened from the Sources section's
 * "load more" row. Geometry, scrolling and the filter field live in
 * `WorkstationRailSubmenu`.
 */
import type React from "react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import AnyIcon from "@src/components/AnyIcon";
import { DropdownItem } from "@src/components/Dropdown/exports";
import type { SubmenuAnchor } from "@src/components/Dropdown/submenuLayout";
import { DROPDOWN_ITEM } from "@src/components/Dropdown/tokens";
import { Link01Icon } from "@src/icons";

import { RailImageThumbnail } from "./RailImageThumbnail";
import {
  WorkstationRailSubmenuPanel,
  useWorkstationRailSubmenuFilter,
} from "./WorkstationRailSubmenu";
import type { FocusedChatRailSource } from "./types";
import { sourceRowLabel } from "./useWorkstationRailSources";

export function WorkstationSourcesSubmenu({
  anchor,
  maxHeight,
  onClose,
  onOpenSource,
  panelRef,
  sources,
  width,
}: {
  anchor: SubmenuAnchor;
  /** Height cap; the rows scroll under it. */
  maxHeight: number;
  onClose: () => void;
  onOpenSource: (source: FocusedChatRailSource) => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
  sources: FocusedChatRailSource[];
  /** Same width as the list the panel opened from. */
  width: number;
}) {
  const { t } = useTranslation();
  // A link is found by its full URL, not only by the shortened row label.
  const sourceSearchText = useCallback(
    (source: FocusedChatRailSource) =>
      source.kind === "link"
        ? `${source.label} ${source.url}`
        : sourceRowLabel(t, source),
    [t]
  );
  const { query, rows, setQuery, showSearch } = useWorkstationRailSubmenuFilter(
    sources,
    sourceSearchText
  );

  return (
    <WorkstationRailSubmenuPanel
      anchor={anchor}
      ariaLabel={t("common:git.rail.sources")}
      emptyLabel={t("common:status.noResults")}
      maxHeight={maxHeight}
      onClose={onClose}
      onSearchChange={setQuery}
      panelRef={panelRef}
      searchValue={query}
      showSearch={showSearch}
      testId="workstation-trail-sources-submenu"
      width={width}
    >
      {rows.map((source) => {
        const label = sourceRowLabel(t, source);
        return (
          <DropdownItem
            key={source.key}
            role="menuitem"
            icon={
              source.kind === "image" ? (
                <RailImageThumbnail
                  key={source.ref}
                  imageRef={source.ref}
                  size={DROPDOWN_ITEM.iconSize}
                />
              ) : (
                <AnyIcon
                  icon={Link01Icon}
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={1.75}
                />
              )
            }
            onClick={() => onOpenSource(source)}
          >
            <span
              className="block min-w-0 truncate"
              title={source.kind === "link" ? source.url : label}
            >
              {label}
            </span>
          </DropdownItem>
        );
      })}
    </WorkstationRailSubmenuPanel>
  );
}

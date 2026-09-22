/**
 * WorkstationRailSubmenu — the second-level panel a rail section's "load
 * more" row opens (Subagents, Sources): its open/close state, geometry, the
 * portaled panel shell, and the filter field long lists earn.
 *
 * The panel is portaled to `document.body`, so it escapes both the wide
 * trail's scroll container and the compact menu's overflow clipping. Unlike
 * the shared right-preferring submenu geometry, it opens on the LEFT of its
 * list and reuses that list's width: the trail lives on the pane's right
 * edge, where every other trail popup (tooltips, the branch switcher) already
 * opens leftward. Vertical fitting still goes through `clampSubmenuTop`. The
 * compact menu keeps itself open while the pointer is inside this panel via
 * the Dropdown `additionalInsideRefs` contract.
 *
 * The row list scrolls inside the panel rather than being clipped by it: a
 * session with a dozen subagents overflowed the panel's max height with no
 * way to reach the rows below the fold.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  DropdownPanel,
  DropdownSearch,
} from "@src/components/Dropdown/exports";
import { subscribeToDropdownOutsideMouseDown } from "@src/components/Dropdown/outsideClick";
import {
  type SubmenuAnchor,
  clampSubmenuTop,
} from "@src/components/Dropdown/submenuLayout";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";

/**
 * Marks the container whose outer edge the submenu aligns to. Falls back to
 * the trigger row's own rect when no marked ancestor exists (the wide rail).
 */
export const WORKSTATION_SUBMENU_BOUNDS_ATTRIBUTE =
  "data-workstation-submenu-bounds";

/** Tallest the panel grows before its rows scroll — the compact menu's cap. */
export const WORKSTATION_SUBMENU_MAX_HEIGHT = 384;

/**
 * Row count from which the panel carries a filter field. Below it the list is
 * shorter than one scroll page and the field is pure chrome.
 */
export const WORKSTATION_SUBMENU_SEARCH_MIN_ROWS = 8;

/** Panel height cap: the shared maximum, bounded by the current viewport. */
export function resolveWorkstationSubmenuMaxHeight(
  viewportHeight: number
): number {
  return Math.max(
    DROPDOWN_PANEL.minAvailableHeight,
    Math.min(
      WORKSTATION_SUBMENU_MAX_HEIGHT,
      viewportHeight - DROPDOWN_PANEL.viewportPadding * 2
    )
  );
}

interface SubmenuState {
  anchor: SubmenuAnchor;
  /** Height cap resolved when the panel opened; its rows scroll below it. */
  maxHeight: number;
  /** Panel width — the parent list's own width, so both levels read as one. */
  width: number;
  triggerElement: HTMLElement;
}

/**
 * Open/close state and geometry for the submenu. The trigger row calls
 * `toggle` with itself; outside mousedowns close the panel, except on the
 * trigger row, whose own click handles the toggle.
 */
export function useWorkstationRailSubmenu() {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<SubmenuState | null>(null);

  const close = useCallback(() => setState(null), []);

  const toggle = useCallback((trigger: HTMLElement) => {
    setState((current) => {
      if (current) return null;
      const triggerRect = trigger.getBoundingClientRect();
      const boundsRect =
        trigger
          .closest(`[${WORKSTATION_SUBMENU_BOUNDS_ATTRIBUTE}]`)
          ?.getBoundingClientRect() ?? null;
      const horizontalBounds = boundsRect ?? triggerRect;
      const width = horizontalBounds.width || DROPDOWN_WIDTHS.panelWidth;
      // Left of the list, mirroring every other popup on the pane's right
      // edge; only a list flush against the window's left edge flips right.
      const leftSideLeft =
        horizontalBounds.left - width - DROPDOWN_PANEL.submenuGap;
      const left =
        leftSideLeft < DROPDOWN_PANEL.viewportPadding
          ? horizontalBounds.right + DROPDOWN_PANEL.submenuGap
          : leftSideLeft;
      return {
        anchor: {
          left,
          opensUpward: false,
          parentTop: boundsRect?.top ?? DROPDOWN_PANEL.viewportPadding,
          parentBottom:
            boundsRect?.bottom ??
            window.innerHeight - DROPDOWN_PANEL.viewportPadding,
          // Pull up by the panel padding so the first submenu row lines up
          // with the row that opened it.
          top: Math.max(
            DROPDOWN_PANEL.viewportPadding,
            triggerRect.top - DROPDOWN_PANEL.padding
          ),
        },
        maxHeight: resolveWorkstationSubmenuMaxHeight(window.innerHeight),
        width,
        triggerElement: trigger,
      };
    });
  }, []);

  // The panel's real height is only known once it has rendered, so the
  // anchor's preferred top is corrected here rather than on open.
  useLayoutEffect(() => {
    if (!state || !panelRef.current) return;
    const { height: submenuHeight } = panelRef.current.getBoundingClientRect();
    const clampedTop = clampSubmenuTop({
      anchor: state.anchor,
      submenuHeight,
      viewportHeight: window.innerHeight,
    });
    if (clampedTop === state.anchor.top) return;
    setState((current) =>
      current
        ? { ...current, anchor: { ...current.anchor, top: clampedTop } }
        : current
    );
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (state.triggerElement.contains(target)) return;
      close();
    };
    return subscribeToDropdownOutsideMouseDown(document, handleMouseDown);
  }, [close, state]);

  return {
    anchor: state?.anchor ?? null,
    close,
    maxHeight: state?.maxHeight ?? WORKSTATION_SUBMENU_MAX_HEIGHT,
    panelRef,
    toggle,
    width: state?.width ?? DROPDOWN_WIDTHS.panelWidth,
  };
}

/**
 * Substring filter over the panel's rows. The submenu unmounts on close, so
 * the query resets with it — every open starts on the full list.
 */
export function useWorkstationRailSubmenuFilter<Row>(
  rows: Row[],
  toSearchText: (row: Row) => string
): {
  query: string;
  rows: Row[];
  setQuery: (query: string) => void;
  showSearch: boolean;
} {
  const [query, setQuery] = useState("");
  // Anchored to the unfiltered length: a field that disappears once the
  // query narrows the list past the threshold would take the caret with it.
  const showSearch = rows.length >= WORKSTATION_SUBMENU_SEARCH_MIN_ROWS;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!showSearch || !normalized) return rows;
    return rows.filter((row) =>
      toSearchText(row).toLowerCase().includes(normalized)
    );
  }, [query, rows, showSearch, toSearchText]);

  return { query, rows: filtered, setQuery, showSearch };
}

export function WorkstationRailSubmenuPanel({
  anchor,
  ariaLabel,
  children,
  emptyLabel,
  maxHeight,
  onClose,
  onSearchChange,
  panelRef,
  searchValue,
  showSearch,
  testId,
  width,
}: {
  anchor: SubmenuAnchor;
  ariaLabel: string;
  children: React.ReactNode;
  /** Shown in place of the rows when the filter matches nothing. */
  emptyLabel: string;
  /** Height cap; the row list scrolls under it. */
  maxHeight: number;
  onClose: () => void;
  onSearchChange: (value: string) => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
  searchValue: string;
  showSearch: boolean;
  testId: string;
  /** Same width as the list the panel opened from. */
  width: number;
}) {
  return createPortal(
    <DropdownPanel
      ref={panelRef}
      className="fixed flex flex-col"
      width={width}
      maxHeight={maxHeight}
      style={{ top: anchor.top, left: anchor.left }}
      role="menu"
      aria-label={ariaLabel}
      data-testid={testId}
      // With the filter field focused, Escape has to reach this panel rather
      // than only clearing the native search input.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      {showSearch ? (
        <DropdownSearch
          value={searchValue}
          onChange={onSearchChange}
          type="text"
          ariaLabel={ariaLabel}
          containerClassName="border-b border-solid border-border-2"
          testId={`${testId}-search`}
        />
      ) : null}
      <div
        className={`${DROPDOWN_CLASSES.optionsContainerOverlay} min-h-0 flex-1`}
      >
        {React.Children.count(children) === 0 ? (
          <div className={DROPDOWN_CLASSES.listMessage}>{emptyLabel}</div>
        ) : (
          children
        )}
      </div>
    </DropdownPanel>,
    document.body
  );
}

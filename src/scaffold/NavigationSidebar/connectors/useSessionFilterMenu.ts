import type React from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  type SubmenuAnchor,
  clampSubmenuTop,
  getSubmenuAnchor,
} from "@src/components/Dropdown/submenuLayout";
import {
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { getViewportSize } from "@src/util/ui/window/viewport";

import type { SessionFilterSubmenu } from "./sessionFilterTypes";

/**
 * The filter menu's dropdown plus its second level: which submenu is open,
 * where it is anchored, and the row handlers that open and close it.
 */
export function useSessionFilterMenu() {
  const sortTriggerRef = useRef<HTMLDivElement | null>(null);
  const groupTriggerRef = useRef<HTMLDivElement | null>(null);
  const visibleCountTriggerRef = useRef<HTMLDivElement | null>(null);
  const submenuPanelRef = useRef<HTMLDivElement | null>(null);
  const submenuInsideRefs = useMemo(() => [submenuPanelRef], []);
  const [activeSubmenu, setActiveSubmenu] =
    useState<SessionFilterSubmenu | null>(null);
  const [submenuAnchor, setSubmenuAnchor] = useState<SubmenuAnchor | null>(
    null
  );

  const closeSubmenu = useCallback(() => {
    setActiveSubmenu(null);
    setSubmenuAnchor(null);
  }, []);

  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeSubmenu();
    },
    [closeSubmenu]
  );

  const {
    isOpen,
    isPositioned,
    toggle,
    close,
    triggerRef,
    panelRef,
    panelPosition,
  } = useDropdownEngine<HTMLDivElement>({
    placement: "top",
    align: "left",
    gap: DROPDOWN_PANEL.triggerGap,
    // Click-opened sidebar menu: own keyboard focus so Escape works even
    // when focus was parked in the chat composer / terminal pane.
    captureKeyboardFocus: true,
    onOpenChange: handleMenuOpenChange,
    additionalInsideRefs: submenuInsideRefs,
  });

  // The submenu's real height is only known once it has rendered, so the
  // anchor's preferred top is corrected here rather than on open.
  useLayoutEffect(() => {
    if (!activeSubmenu || !submenuAnchor || !submenuPanelRef.current) {
      return;
    }

    const { height: submenuHeight } =
      submenuPanelRef.current.getBoundingClientRect();
    const { height: viewportHeight } = getViewportSize();
    const clampedTop = clampSubmenuTop({
      anchor: submenuAnchor,
      submenuHeight,
      viewportHeight,
    });

    if (clampedTop === submenuAnchor.top) return;
    setSubmenuAnchor((current) =>
      current ? { ...current, top: clampedTop } : current
    );
  }, [activeSubmenu, submenuAnchor]);

  const openSubmenu = useCallback(
    (submenu: SessionFilterSubmenu, trigger: HTMLElement) => {
      const { width: viewportWidth, height: viewportHeight } =
        getViewportSize();
      setSubmenuAnchor(
        getSubmenuAnchor({
          triggerRect: trigger.getBoundingClientRect(),
          parentRect: panelRef.current?.getBoundingClientRect() ?? null,
          submenuWidth: DROPDOWN_WIDTHS.panelWidth,
          viewportWidth,
          viewportHeight,
          opensUpward: panelPosition.bottom !== undefined,
        })
      );
      setActiveSubmenu(submenu);
    },
    [panelPosition.bottom, panelRef]
  );

  const handleSubmenuTriggerEnter = useCallback(
    (submenu: SessionFilterSubmenu) => {
      const trigger =
        submenu === "groupBy"
          ? groupTriggerRef.current
          : submenu === "sort"
            ? sortTriggerRef.current
            : visibleCountTriggerRef.current;
      if (trigger) openSubmenu(submenu, trigger);
    },
    [openSubmenu]
  );

  const handleSubmenuTriggerClick = useCallback(
    (submenu: SessionFilterSubmenu) => {
      // Keyboard and automated interactions never fire the hover that normally
      // opens this row, so a click opens it too.
      if (activeSubmenu === submenu) {
        closeSubmenu();
        return;
      }
      handleSubmenuTriggerEnter(submenu);
    },
    [activeSubmenu, closeSubmenu, handleSubmenuTriggerEnter]
  );

  const handleSubmenuPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
    },
    []
  );

  const handleSubmenuMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
    },
    []
  );

  return {
    isOpen,
    isPositioned,
    toggle,
    close,
    triggerRef,
    panelRef,
    panelPosition,
    sortTriggerRef,
    groupTriggerRef,
    visibleCountTriggerRef,
    submenuPanelRef,
    activeSubmenu,
    submenuAnchor,
    closeSubmenu,
    handleSubmenuTriggerEnter,
    handleSubmenuTriggerClick,
    handleSubmenuPointerDown,
    handleSubmenuMouseDown,
  };
}

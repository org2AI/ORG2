import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  clampSubmenuTop,
  getSubmenuAnchor,
} from "@src/components/Dropdown/submenuLayout";
import {
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import {
  type DropdownEnginePosition,
  useDropdownEngine,
} from "@src/hooks/dropdown";
import { getViewportSize } from "@src/util/ui/window/viewport";

import type {
  SettingsSubmenu,
  SubmenuPosition,
} from "./SidebarSettingsMenuSubmenus";
import type { SidebarSettingsMenuButtonProps } from "./sidebarSettingsMenuTypes";

type SettingsUtilityPanel = "ram";

function getSubmenuPosition(
  trigger: HTMLElement,
  parentPanel: HTMLElement | null,
  opensUpward: boolean
): SubmenuPosition {
  const { width: viewportWidth, height: viewportHeight } = getViewportSize();
  return getSubmenuAnchor({
    triggerRect: trigger.getBoundingClientRect(),
    parentRect: parentPanel?.getBoundingClientRect() ?? null,
    submenuWidth: DROPDOWN_WIDTHS.panelWidth,
    viewportWidth,
    viewportHeight,
    opensUpward,
  });
}

/**
 * Open state of the settings dropdown, its hover submenu and the dev-mode
 * utility panel, plus the handlers that move between them.
 */
export function useSidebarSettingsMenuPopovers({
  renderTrigger,
}: Pick<SidebarSettingsMenuButtonProps, "renderTrigger">) {
  const utilityPanelRef = useRef<HTMLDivElement | null>(null);
  const submenuPanelRef = useRef<HTMLDivElement | null>(null);
  const preserveUtilityPanelOnMenuCloseRef = useRef(false);
  const dropdownInsideRefs = useMemo(() => [submenuPanelRef], []);
  const [activeSubmenu, setActiveSubmenu] = useState<SettingsSubmenu | null>(
    null
  );
  const [submenuPosition, setSubmenuPosition] =
    useState<SubmenuPosition | null>(null);
  const [utilityPanel, setUtilityPanel] = useState<SettingsUtilityPanel | null>(
    null
  );
  const [utilityPanelPosition, setUtilityPanelPosition] =
    useState<DropdownEnginePosition | null>(null);

  useLayoutEffect(() => {
    if (!activeSubmenu || !submenuPosition || !submenuPanelRef.current) return;

    const { height: submenuHeight } =
      submenuPanelRef.current.getBoundingClientRect();
    const { height: viewportHeight } = getViewportSize();
    const clampedTop = clampSubmenuTop({
      anchor: submenuPosition,
      submenuHeight,
      viewportHeight,
    });

    if (clampedTop === submenuPosition.top) return;
    setSubmenuPosition((current) =>
      current ? { ...current, top: clampedTop } : current
    );
  }, [activeSubmenu, submenuPosition]);

  const handleSettingsMenuOpenChange = useCallback((open: boolean) => {
    if (open) return;
    setActiveSubmenu(null);
    setSubmenuPosition(null);
    if (preserveUtilityPanelOnMenuCloseRef.current) {
      preserveUtilityPanelOnMenuCloseRef.current = false;
      return;
    }
    setUtilityPanel(null);
  }, []);
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
    align: renderTrigger ? "left" : "right",
    gap: DROPDOWN_PANEL.triggerGap,
    onOpenChange: handleSettingsMenuOpenChange,
    additionalInsideRefs: dropdownInsideRefs,
  });

  const closeAll = useCallback(() => {
    setActiveSubmenu(null);
    setSubmenuPosition(null);
    setUtilityPanel(null);
    close();
  }, [close]);

  const handleToggle = useCallback(() => {
    if (isOpen) {
      closeAll();
      return;
    }
    setUtilityPanel(null);
    toggle();
  }, [closeAll, isOpen, toggle]);

  const openSubmenu = useCallback(
    (submenu: SettingsSubmenu, target: HTMLElement) => {
      setActiveSubmenu(submenu);
      setSubmenuPosition(
        getSubmenuPosition(
          target,
          panelRef.current,
          panelPosition.bottom !== undefined
        )
      );
    },
    [panelPosition.bottom, panelRef]
  );

  const handleOpenUtilityPanel = useCallback(
    (panel: SettingsUtilityPanel) => {
      setActiveSubmenu(null);
      setSubmenuPosition(null);
      preserveUtilityPanelOnMenuCloseRef.current = true;
      setUtilityPanelPosition({ ...panelPosition });
      setUtilityPanel(panel);
      close();
    },
    [close, panelPosition]
  );

  const handleViewRam = useCallback(() => {
    handleOpenUtilityPanel("ram");
  }, [handleOpenUtilityPanel]);

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
    utilityPanelRef,
    submenuPanelRef,
    activeSubmenu,
    setActiveSubmenu,
    submenuPosition,
    utilityPanel,
    setUtilityPanel,
    utilityPanelPosition,
    isOpen,
    isPositioned,
    triggerRef,
    panelRef,
    panelPosition,
    closeAll,
    handleToggle,
    openSubmenu,
    handleViewRam,
    handleSubmenuPointerDown,
    handleSubmenuMouseDown,
  };
}

interface UseSidebarUtilityPanelDismissOptions {
  utilityPanel: SettingsUtilityPanel | null;
  utilityPanelRef: React.RefObject<HTMLDivElement | null>;
  setUtilityPanel: React.Dispatch<
    React.SetStateAction<SettingsUtilityPanel | null>
  >;
}

/** Closes the open utility panel on an outside pointerdown or on Escape. */
export function useSidebarUtilityPanelDismiss({
  utilityPanel,
  utilityPanelRef,
  setUtilityPanel,
}: UseSidebarUtilityPanelDismissOptions): void {
  useEffect(() => {
    if (!utilityPanel) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (utilityPanelRef.current?.contains(target)) return;
      setUtilityPanel(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUtilityPanel(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [setUtilityPanel, utilityPanel, utilityPanelRef]);
}

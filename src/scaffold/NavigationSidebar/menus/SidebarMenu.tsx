import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  ActionMenuSurface,
  ActionSubmenu,
} from "@src/components/Dropdown/ActionMenuSurface";
import DropdownActionItem from "@src/components/Dropdown/DropdownActionItem";
import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { HugeiconsIcon } from "@src/icons";
import type { SidebarMenuItem } from "@src/scaffold/NavigationSidebar/menus/types";
import { useOverlayLayer } from "@src/store/ui/overlayLayerAtom";

import { SidebarSessionOpenInApp } from "./SidebarSessionOpenInApp";

const OPEN_EVENT = "orgii-sidebar-menu";
interface MenuRequest {
  source: string;
  items: SidebarMenuItem[];
  anchor: HTMLElement;
  x: number;
  y: number;
  triggerTop?: number;
}

/** Route to the originating sidebar, preserving its React providers and lifetime. */
export async function popupSidebarMenu(
  event: React.MouseEvent,
  options: {
    source: string;
    buildItems: () => SidebarMenuItem[];
  }
): Promise<void> {
  const anchor = event.currentTarget as HTMLElement;
  const rect = anchor.getBoundingClientRect();
  const pointerContextMenu =
    event.type === "contextmenu" &&
    (event.clientX !== 0 || event.clientY !== 0);
  const request: MenuRequest = {
    source: options.source,
    items: options.buildItems(),
    anchor,
    triggerTop: pointerContextMenu ? undefined : rect.top,
    x: pointerContextMenu ? event.clientX : rect.left,
    y: pointerContextMenu
      ? event.clientY
      : rect.bottom + DROPDOWN_PANEL.triggerGap,
  };
  anchor.dispatchEvent(
    new CustomEvent(OPEN_EVENT, { bubbles: true, detail: request })
  );
}

function MenuRows({
  items,
  close,
}: {
  items: SidebarMenuItem[];
  close: () => void;
}) {
  return (
    <div className={`flex flex-col ${DROPDOWN_PANEL.itemsGapClass}`}>
      {items.map((item, index) => {
        if ("item" in item) {
          return (
            <div
              key={index}
              role="separator"
              className={DROPDOWN_CLASSES.menuGroupSeparator}
            />
          );
        }
        if (item.section && item.items) {
          return (
            <div key={index} role="group" aria-label={item.text}>
              <div className={DROPDOWN_CLASSES.sectionLabel}>{item.text}</div>
              <MenuRows items={item.items} close={close} />
            </div>
          );
        }
        const icon = item.icon ? (
          <HugeiconsIcon
            icon={item.icon}
            size={DROPDOWN_ITEM.iconSize}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        ) : undefined;
        if (item.items) {
          // Sidebar builders supply plain options, never allocated native resources.
          return (
            <ActionSubmenu
              key={index}
              label={item.text}
              icon={icon}
              disabled={item.enabled === false}
              observeContentResize={Boolean(item.appOpenSessionId)}
              dataTestId={`sidebar-submenu-${index}`}
            >
              <MenuRows items={item.items} close={close} />
              {item.appOpenSessionId && (
                <SidebarSessionOpenInApp
                  sessionId={item.appOpenSessionId}
                  onClose={close}
                />
              )}
            </ActionSubmenu>
          );
        }
        return (
          <DropdownActionItem
            key={index}
            icon={icon}
            danger={item.danger}
            disabled={item.enabled === false}
            aria-disabled={item.enabled === false || undefined}
            role={"checked" in item ? "menuitemcheckbox" : "menuitem"}
            aria-checked={"checked" in item ? item.checked : undefined}
            suffix={
              "checked" in item && item.checked ? (
                <DropdownSelectedCheck />
              ) : undefined
            }
            onClick={() => {
              close();
              if ("action" in item) item.action?.(item.id ?? String(index));
            }}
          >
            {item.text}
          </DropdownActionItem>
        );
      })}
    </div>
  );
}

function OpenSidebarMenu({
  request,
  close,
}: {
  request: MenuRequest;
  close: () => void;
}) {
  useOverlayLayer(true);
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // The menu is portaled, so :hover and :focus-within no longer reach the
    // originating row. Own only transient DOM attributes; never change the
    // row's navigation selection or the button's persistent pressed state.
    const row =
      request.anchor.closest<HTMLElement>("[data-menu-item-id]") ??
      request.anchor.querySelector<HTMLElement>(":scope > [data-menu-item-id]");
    const trigger = request.anchor.matches("button")
      ? request.anchor
      : row?.querySelector<HTMLElement>("[data-sidebar-menu-trigger]");
    const elements = [row, trigger].filter((element): element is HTMLElement =>
      Boolean(element)
    );
    for (const element of elements)
      element.setAttribute("data-sidebar-menu-open", "true");
    const expanded = trigger?.getAttribute("aria-expanded");
    const hasPopup = trigger?.getAttribute("aria-haspopup");
    trigger?.setAttribute("aria-expanded", "true");
    trigger?.setAttribute("aria-haspopup", "menu");
    return () => {
      for (const element of elements)
        element.removeAttribute("data-sidebar-menu-open");
      if (expanded == null) trigger?.removeAttribute("aria-expanded");
      else trigger?.setAttribute("aria-expanded", expanded);
      if (hasPopup == null) trigger?.removeAttribute("aria-haspopup");
      else trigger?.setAttribute("aria-haspopup", hasPopup);
    };
  }, [request]);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const position = () => {
      const rect = panel.getBoundingClientRect();
      const padding = DROPDOWN_PANEL.viewportPadding;
      panel.style.left = `${Math.max(padding, Math.min(request.x, window.innerWidth - rect.width - padding))}px`;
      const above =
        request.triggerTop === undefined
          ? undefined
          : request.triggerTop - rect.height - DROPDOWN_PANEL.triggerGap;
      const preferredTop =
        request.y + rect.height > window.innerHeight - padding &&
        above !== undefined &&
        above >= padding
          ? above
          : request.y;
      panel.style.top = `${Math.max(padding, Math.min(preferredTop, window.innerHeight - rect.height - padding))}px`;
    };
    position();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(position);
    observer?.observe(panel);
    panel
      .querySelector<HTMLElement>(
        'button:not(:disabled), [role="menuitem"]:not([aria-disabled="true"])'
      )
      ?.focus();
    return () => {
      observer?.disconnect();
      if (panel.contains(document.activeElement) && request.anchor.isConnected)
        request.anchor.focus();
    };
  }, [request]);

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) close();
    };
    const visibility = () => {
      if (document.hidden) close();
    };
    const scroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", outside, true);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [close]);

  return createPortal(
    <ActionMenuSurface
      panelRef={panelRef}
      fitSubmenus
      onClose={close}
      aria-label={request.anchor.getAttribute("aria-label") ?? undefined}
      data-sidebar-menu={request.source}
      className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.sidebarMenuClass} fixed flex flex-col ${DROPDOWN_PANEL.itemsGapClass} overflow-y-auto`}
      style={{
        left: request.x,
        top: request.y,
        maxHeight: `calc(100vh - ${2 * DROPDOWN_PANEL.viewportPadding}px)`,
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <MenuRows items={request.items} close={close} />
    </ActionMenuSurface>,
    document.body
  );
}

/** One bounded menu per mounted sidebar; closing drops all captured actions. */
export function SidebarMenuHost({
  sidebarRef,
}: {
  sidebarRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [request, setRequest] = useState<MenuRequest | null>(null);
  const close = useCallback(() => setRequest(null), []);
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const open = (event: Event) => {
      event.stopPropagation();
      const next = (event as CustomEvent<MenuRequest>).detail;
      setRequest(next.items.length ? next : null);
    };
    sidebar.addEventListener(OPEN_EVENT, open);
    return () => sidebar.removeEventListener(OPEN_EVENT, open);
  }, [sidebarRef]);
  if (!request) return null;
  return (
    <OpenSidebarMenu key={request.source} request={request} close={close} />
  );
}

/**
 * SidebarBase
 *
 * The foundational wrapper for all sidebar components.
 * Handles: transparent sidebar surface, resize, collapse, and the chrome row
 * (traffic-light spacing on macOS, the in-flow toggle group elsewhere).
 *
 */
import i18next from "i18next";
import { useAtomValue } from "jotai";
import React, { useCallback, useEffect, useMemo, useRef } from "react";

import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import SessionHistoryNav from "@src/components/SessionHistoryNav";
import { SIDEBAR_CHROME_BUTTON_HOVER_CLASS } from "@src/components/SidebarChromeIconButton";
import Tooltip from "@src/components/Tooltip";
import { useShortcutKeys } from "@src/config/keyboard/useShortcutBindings";
import {
  HOST_DESKTOP,
  resolveHostDesktop,
} from "@src/config/windowChromeRadius";
import { createLogger } from "@src/hooks/logger";
import { useSettingValue } from "@src/hooks/settings/useSettings";
import { useCollapsedSidebarChromeOffset } from "@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset";
import { useSidebarState } from "@src/hooks/ui/sidebar/useSidebarState";
import { Add01Icon } from "@src/icons";
import {
  PANE_WIDTH_TRANSITION_CLASSES,
  getSidebarSurfaceBackgroundStyle,
} from "@src/modules/shared/layouts/viewContainerTokens";
import { VerticalResizeHandle } from "@src/scaffold/Resize";
import { resolvedBackgroundConfigAtom } from "@src/store/ui/backgroundConfigAtom";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "@src/store/ui/sidebarAtom";
import { popupNativeMenu } from "@src/util/platform/tauri/nativeMenuPopup";

import { SidebarChromeToggle } from "./SidebarChromeToggle";
import { SIDEBAR_STYLE, SIDEBAR_TOOLTIP_HOVER_DELAY } from "./config";
import { useForceVisibleSidebar } from "./contexts/ForceVisibleContext";
import type { SidebarBaseProps } from "./types";

const log = createLogger("SidebarBase");

const HOST_DESKTOP_KIND = resolveHostDesktop();
const IS_MACOS_HOST = HOST_DESKTOP_KIND === HOST_DESKTOP.MACOS;
const IS_WINDOWS_HOST = HOST_DESKTOP_KIND === HOST_DESKTOP.WINDOWS;
const IS_WINDOWS_OR_LINUX_HOST =
  HOST_DESKTOP_KIND === HOST_DESKTOP.WINDOWS ||
  HOST_DESKTOP_KIND === HOST_DESKTOP.LINUX;
const SHOW_RESTING_SIDEBAR_EDGE = HOST_DESKTOP_KIND === HOST_DESKTOP.LINUX;

const IDLE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME =
  "h-full [&>div:first-child]:origin-right [&>div:first-child]:scale-x-50 [&>div:first-child]:transition-transform hover:[&>div:first-child]:scale-x-100";

// ============================================
// SidebarBase Component
// ============================================

const SidebarBase: React.FC<SidebarBaseProps> = React.memo(
  ({
    children,
    className = "",
    onAddNew,
    addIcon: AddIcon = Add01Icon,
    addLabel,
    addTooltipContent,
    beforeAddNewActions,
    headerActions,
    topBarFollowingContent,
    solidSurface = false,
    includeTrafficLightSpace = true,
    showCollapseButton = true,
  }) => {
    const sidebarContainerRef = useRef<HTMLDivElement>(null);
    const {
      width: sidebarWidth,
      expandedWidth: expandedSidebarWidth,
      isDragging,
      handleMouseDown,
      isCollapsed,
      collapse,
      setWidth,
    } = useSidebarState();
    const sidebarSelectedRowOpacity = useSettingValue(
      "layout.sidebarSelectedRowOpacity"
    );
    const sidebarEdgeDepthEnabled = useSettingValue(
      "layout.sidebarEdgeDepthEnabled"
    );
    const translucentSidebar = useSettingValue("general.translucentSidebar");
    useEffect(() => {
      document.body.style.setProperty(
        "--sidebar-selected-row-opacity",
        `${sidebarSelectedRowOpacity}%`
      );
    }, [sidebarSelectedRowOpacity]);
    const hideSidebarShortcut = useShortcutKeys("toggle_sidebar");
    // macOS: traffic lights (or the full-screen edge inset) plus the pinned
    // toggle + Back / Forward group the row only reserves space under.
    const pinnedChromeOffset = useCollapsedSidebarChromeOffset();
    const backgroundConfig = useAtomValue(resolvedBackgroundConfigAtom);
    const sidebarOpacityStyle = useMemo(
      () => getSidebarSurfaceBackgroundStyle(backgroundConfig.sidebarOpacity),
      [backgroundConfig.sidebarOpacity]
    );

    // Check for force visible from context (for hover sidebar)
    const shouldForceVisible = useForceVisibleSidebar();
    useEffect(() => {
      if (!isCollapsed || shouldForceVisible) return;
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        sidebarContainerRef.current?.contains(activeElement)
      ) {
        activeElement.blur();
      }
    }, [isCollapsed, shouldForceVisible]);

    const handleResizeContextMenu = useCallback(
      (event: React.MouseEvent) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();

        const isAlreadyDefault = sidebarWidth === DEFAULT_SIDEBAR_WIDTH;
        const isAlreadyMin = sidebarWidth <= MIN_SIDEBAR_WIDTH;

        void popupNativeMenu({
          source: "navigation-sidebar",
          buildItems: () => {
            const t = i18next.t.bind(i18next);
            return [
              {
                text: t("tooltips.resizeToDefault", {
                  width: DEFAULT_SIDEBAR_WIDTH,
                }),
                enabled: !isAlreadyDefault,
                action: () => {
                  setWidth(DEFAULT_SIDEBAR_WIDTH);
                },
              },
              {
                text: t("tooltips.minimizeWidth", {
                  width: MIN_SIDEBAR_WIDTH,
                }),
                enabled: !isAlreadyMin,
                action: () => {
                  setWidth(MIN_SIDEBAR_WIDTH);
                },
              },
              { item: "Separator" as const },
              {
                text: t("tooltips.hideSidebar"),
                action: () => {
                  collapse();
                },
              },
            ];
          },
        }).catch((error) => {
          log.error("Failed to show sidebar context menu:", error);
        });
      },
      [sidebarWidth, setWidth, collapse]
    );

    // When forceVisible and collapsed, use default width instead of 0
    const effectiveWidth =
      shouldForceVisible && isCollapsed ? DEFAULT_SIDEBAR_WIDTH : sidebarWidth;
    const surfaceWidth =
      shouldForceVisible && isCollapsed
        ? DEFAULT_SIDEBAR_WIDTH
        : expandedSidebarWidth;

    // Memoize outer container style to avoid re-creating on every render
    const containerStyle = useMemo(
      () =>
        ({
          width: `${effectiveWidth}px`,
          willChange: isDragging ? ("width" as const) : ("auto" as const),
          pointerEvents:
            isCollapsed && !shouldForceVisible ? ("none" as const) : undefined,
          "--sidebar-selected-row-opacity": `${sidebarSelectedRowOpacity}%`,
        }) as React.CSSProperties,
      [
        effectiveWidth,
        isCollapsed,
        isDragging,
        shouldForceVisible,
        sidebarSelectedRowOpacity,
      ]
    );

    // Chrome row: the 36px title-bar row every host places its sidebar chrome
    // in. macOS keeps the traffic lights and the pinned toggle group on the
    // left in window space and only reserves the space under them; every
    // other host draws the same toggle + Back / Forward group in flow at the
    // 8px inset the collapsed-sidebar hosts use, so it holds its spot across
    // both states. Add-new and the extra actions sit at the right edge.
    const renderChromeRow = () => {
      const alignmentClassName = IS_WINDOWS_OR_LINUX_HOST
        ? "justify-between pl-2 pr-2"
        : "justify-end pr-2";

      return (
        <div
          className={`flex flex-nowrap items-center gap-1 ${alignmentClassName}`}
          data-tauri-drag-region
          data-testid="sidebar-chrome-row"
          style={
            {
              height: `${SIDEBAR_STYLE.topBarHeight}px`,
              // Only macOS needs an inline reserve for the traffic lights.
              // Windows/Linux (and browser mode, which resolves to Linux) must
              // fall through to the alignment class above — an inline `0px`
              // would beat `pl-2` and pull the group flush to the sidebar
              // edge, out of line with the collapsed-sidebar hosts.
              paddingLeft: IS_WINDOWS_OR_LINUX_HOST
                ? undefined
                : `${pinnedChromeOffset}px`,
              WebkitAppRegion: IS_WINDOWS_HOST ? "no-drag" : "drag",
            } as React.CSSProperties
          }
        >
          {IS_WINDOWS_OR_LINUX_HOST && showCollapseButton ? (
            <div
              className="flex shrink-0 items-center gap-px"
              data-testid="sidebar-chrome-leading-group"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <SidebarChromeToggle variant="sidebar" />
              <SessionHistoryNav
                variant="sidebar"
                tooltipMouseEnterDelay={SIDEBAR_TOOLTIP_HOVER_DELAY}
              />
            </div>
          ) : null}
          <div className="pointer-events-auto flex shrink-0 items-center gap-px opacity-100">
            {beforeAddNewActions ? (
              <div
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                {beforeAddNewActions}
              </div>
            ) : null}

            {/* Top action button */}
            {onAddNew && (
              <div
                className="shrink-0"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                <Tooltip
                  content={
                    addTooltipContent ||
                    addLabel ||
                    i18next.t("navigation:sidebar.actions.addNew")
                  }
                  position="bottom"
                  mouseEnterDelay={SIDEBAR_TOOLTIP_HOVER_DELAY}
                  showArrow={false}
                  framedPanel={!!addTooltipContent}
                >
                  <span className="inline-flex">
                    <Button
                      htmlType="button"
                      variant="tertiary"
                      size="small"
                      iconOnly
                      className={SIDEBAR_CHROME_BUTTON_HOVER_CLASS}
                      onClick={onAddNew}
                      aria-label={
                        addLabel ??
                        i18next.t("navigation:sidebar.actions.addNew")
                      }
                      icon={
                        <AnyIcon
                          icon={AddIcon}
                          size={16}
                          strokeWidth={2}
                          className="text-text-2"
                        />
                      }
                    />
                  </span>
                </Tooltip>
              </div>
            )}

            {headerActions ? (
              <div
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                {headerActions}
              </div>
            ) : null}
          </div>
        </div>
      );
    };

    const renderResizeHandle = () => (
      <div
        className="absolute top-0 right-0 z-50 h-full"
        style={{ pointerEvents: "auto" }}
      >
        <VerticalResizeHandle
          className={IDLE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME}
          isResizing={isDragging}
          noAccent={IS_WINDOWS_HOST}
          indicatorPlacement="center"
          onMouseDown={handleMouseDown}
          onContextMenu={handleResizeContextMenu}
          tooltipLabel={i18next.t("common:tooltips.hideSidebar")}
          tooltipShortcut={hideSidebarShortcut}
          variant={SHOW_RESTING_SIDEBAR_EDGE ? "border" : "transparent"}
        />
      </div>
    );

    // Content
    // Modern layout: the sidebar surface itself reaches the top window edge
    // (no outer `pt-2`), so we move the 8px top breathing room inside via a
    // spacer div. This keeps the header / icons at the same vertical position
    // as the previous alternatives while letting the surface cover the full sidebar column.
    const content = (
      <>
        <div
          className="h-2 shrink-0"
          data-tauri-drag-region
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          aria-hidden
        />
        {includeTrafficLightSpace ? renderChromeRow() : null}
        {topBarFollowingContent}
        <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
      </>
    );

    // Modern layout: the sidebar is flush with the rounded window edge
    // (top-left + bottom-left curves match `--border-radius-window`). Avoid
    // a broad docked drop shadow because it traces the window corner. On
    // macOS, use a narrow inset edge shadow instead: it creates the vertical
    // Codex-style depth where the sidebar meets the content panel without
    // bleeding outside the rounded clip.
    //
    // Floating / hover sidebar: it pops out over the workspace content as
    // a transient overlay. It should feel solid (so it's legible against
    // whatever's behind it) and should ignore the user's sidebarOpacity
    // setting. We paint `--color-bg-1` (the design-system solid raised
    // surface) and keep the floating drop shadow regardless of the
    // current layout mode so it visually detaches from the workspace.
    const sidebarBoxShadow = shouldForceVisible
      ? "var(--sidebar-shadow)"
      : IS_MACOS_HOST && sidebarEdgeDepthEnabled
        ? "var(--sidebar-edge-shadow)"
        : "none";
    // Translucency is opt-out. When it is off the sidebar must read as a solid
    // panel: no backdrop blur, no alpha in the surface color, and the opacity
    // slider is ignored rather than merely clamped — a half-transparent
    // "opaque" sidebar would be worse than either end of the setting.
    //
    // A floating/hover sidebar overlays workspace content and is always solid,
    // regardless of this preference, so it stays legible over whatever it covers.
    const isTranslucentSurface =
      translucentSidebar && !shouldForceVisible && !solidSurface;
    const sidebarBackdropFilter = isTranslucentSurface
      ? "var(--sidebar-backdrop)"
      : "none";
    const opaqueSurfaceOverride: React.CSSProperties = isTranslucentSurface
      ? {}
      : { backgroundColor: "var(--color-bg-1)" };
    const surfaceStyle = {
      backgroundColor: IS_WINDOWS_HOST
        ? "color-mix(in srgb, var(--color-bg-2) var(--windows-native-chrome-opacity, 30%), transparent)"
        : "var(--sidebar-bg)",
      borderColor: "var(--sidebar-border)",
      boxShadow: sidebarBoxShadow,
      backdropFilter: sidebarBackdropFilter,
      WebkitBackdropFilter: sidebarBackdropFilter,
      ...(IS_WINDOWS_HOST || !isTranslucentSurface ? {} : sidebarOpacityStyle),
      ...opaqueSurfaceOverride,
    };

    // Wrapped content
    // Modern layout: sidebar is flush with the top/left/bottom window edge —
    // no outer padding, no border radius on the right (it butts against the
    // content panel). The top-left and bottom-left corners follow the window
    // radius (`--border-radius-window`) so the sidebar surface aligns with
    // the rounded window/body clip instead of leaving a sliver of the body
    // Modern chrome keeps the sidebar flush against the rounded window edge.
    // On macOS the native AbuttedSidebar material already defines the shared
    // edge, while on Windows the rounded content surface owns it. Drawing a
    // separate separator on either platform creates a redundant vertical line.
    const modernSurfaceStyle = {
      // The Windows header spans the full native top edge and owns both top
      // radii. Rounding the sidebar again below it creates a detached inner
      // curve; macOS has no HTML topbar, so its sidebar still owns this corner.
      borderTopLeftRadius: IS_WINDOWS_HOST ? 0 : "var(--border-radius-window)",
      borderBottomLeftRadius: "var(--border-radius-window)",
      borderTopRightRadius: 0,
      borderBottomRightRadius: 0,
      borderTopWidth: 0,
      borderLeftWidth: 0,
      borderBottomWidth: 0,
      borderRightWidth: SHOW_RESTING_SIDEBAR_EDGE ? 1 : 0,
    } as const;
    const wrappedContent = (
      <div className="sidebar-base flex h-full w-full flex-col overflow-hidden">
        <div
          className="flex h-full flex-none flex-col overflow-hidden"
          style={{
            ...surfaceStyle,
            ...modernSurfaceStyle,
            width: `${surfaceWidth}px`,
          }}
        >
          {content}
        </div>
      </div>
    );

    return (
      <div
        ref={sidebarContainerRef}
        className={`group/sidebar relative flex h-full shrink-0 ${
          isDragging ? "" : PANE_WIDTH_TRANSITION_CLASSES
        } ${className}`}
        style={containerStyle}
        aria-hidden={isCollapsed && !shouldForceVisible}
        data-sidebar-collapsed={isCollapsed || undefined}
        onContextMenu={handleResizeContextMenu}
      >
        {wrappedContent}
        {(!isCollapsed || shouldForceVisible) && renderResizeHandle()}
      </div>
    );
  }
);

SidebarBase.displayName = "SidebarBase";

export default SidebarBase;

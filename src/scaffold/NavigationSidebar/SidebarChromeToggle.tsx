/**
 * SidebarChromeToggle
 *
 * The sidebar show / hide control, in whichever state the sidebar is in:
 * hide while it is open, show while it is collapsed, and expand while
 * the hover sidebar is peeking in over a collapsed one.
 *
 * macOS draws it inside `PinnedSidebarChrome`, pinned in window space after
 * the traffic lights. Every other host draws it in flow at the head of the
 * sidebar's own chrome row, where the collapsed-sidebar hosts place the same
 * group, so it never moves between the two states there either.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { SessionHistoryNavVariant } from "@src/components/SessionHistoryNav";
import SidebarChromeIconButton from "@src/components/SidebarChromeIconButton";
import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import {
  HugeiconsIcon,
  type IconSvgElement,
  LayoutAlignLeftIcon,
  PanelLeftIcon,
} from "@src/icons";
import { SIDEBAR_TOOLTIP_HOVER_DELAY } from "@src/scaffold/NavigationSidebar/config";
import { hoverSidebarOpenAtom } from "@src/store/ui/hoverSidebarAtom";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";

interface ChromeButtonProps {
  variant: SessionHistoryNavVariant;
  label: string;
  shortcutId?: string;
  onClick: () => void;
  onMouseEnter?: React.MouseEventHandler<HTMLButtonElement>;
  testId: string;
  icon: IconSvgElement;
  dataIcon: string;
  /** Second glyph swapped in on hover, without a cross-fade. */
  hoverIcon?: IconSvgElement;
  hoverDataIcon?: string;
}

const ChromeButton: React.FC<ChromeButtonProps> = ({
  variant,
  label,
  shortcutId,
  onClick,
  onMouseEnter,
  testId,
  icon,
  dataIcon,
  hoverIcon,
  hoverDataIcon,
}) => {
  const glyphs = (
    <span className="flex h-4 w-4 items-center justify-center">
      <HugeiconsIcon
        icon={icon}
        data-icon={dataIcon}
        size={16}
        strokeWidth={2}
        className={hoverIcon ? "group-hover/toggle:hidden" : undefined}
      />
      {hoverIcon ? (
        <HugeiconsIcon
          icon={hoverIcon}
          data-icon={hoverDataIcon}
          size={16}
          strokeWidth={2}
          className="hidden group-hover/toggle:block"
        />
      ) : null}
    </span>
  );
  if (variant === "sidebar") {
    return (
      <SidebarChromeIconButton
        title={label}
        shortcutId={shortcutId}
        tooltipMouseEnterDelay={SIDEBAR_TOOLTIP_HOVER_DELAY}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        className="group/toggle"
        data-testid={testId}
      >
        {glyphs}
      </SidebarChromeIconButton>
    );
  }
  return (
    <TabBarTrailingIconButton
      title={label}
      shortcutId={shortcutId}
      tooltipPosition="bottom"
      tooltipMouseEnterDelay={SIDEBAR_TOOLTIP_HOVER_DELAY}
      nativeTitle={false}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className="group/toggle"
      data-testid={testId}
    >
      {glyphs}
    </TabBarTrailingIconButton>
  );
};

/**
 * Which surface's tokens the group borrows: the sidebar while it is open (or
 * peeking in as the hover sidebar), the chat pane otherwise.
 */
export function useSidebarChromeVariant(): SessionHistoryNavVariant {
  const collapsed = useAtomValue(sidebarCollapsedAtom);
  const hoverOpen = useAtomValue(hoverSidebarOpenAtom);
  return !collapsed || hoverOpen ? "sidebar" : "chat";
}

interface SidebarChromeToggleProps {
  variant: SessionHistoryNavVariant;
}

const SidebarChromeToggleComponent: React.FC<SidebarChromeToggleProps> = ({
  variant,
}) => {
  const { t } = useTranslation("sessions");
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const hoverOpen = useAtomValue(hoverSidebarOpenAtom);
  const setHoverOpen = useSetAtom(hoverSidebarOpenAtom);

  const hide = useCallback(() => setCollapsed(true), [setCollapsed]);
  const show = useCallback(() => setCollapsed(false), [setCollapsed]);
  const peek = useCallback(() => setHoverOpen(true), [setHoverOpen]);
  const expandFromHover = useCallback(() => {
    setHoverOpen(false);
    setCollapsed(false);
  }, [setCollapsed, setHoverOpen]);

  if (collapsed && hoverOpen) {
    return (
      <ChromeButton
        variant={variant}
        label={t("common:tooltips.showSidebar")}
        shortcutId="toggle_sidebar"
        onClick={expandFromHover}
        testId="sidebar-chrome-expand"
        icon={PanelLeftIcon}
        dataIcon="panel-left"
      />
    );
  }
  if (collapsed) {
    return (
      <ChromeButton
        variant={variant}
        label={t("common:tooltips.showSidebar")}
        shortcutId="toggle_sidebar"
        onClick={show}
        onMouseEnter={peek}
        testId="sidebar-chrome-show"
        icon={LayoutAlignLeftIcon}
        dataIcon="layout-align-left"
        hoverIcon={PanelLeftIcon}
        hoverDataIcon="panel-left"
      />
    );
  }
  return (
    <ChromeButton
      variant={variant}
      label={t("common:tooltips.hideSidebar")}
      shortcutId="toggle_sidebar"
      onClick={hide}
      testId="sidebar-chrome-hide"
      icon={PanelLeftIcon}
      dataIcon="panel-left"
      hoverIcon={LayoutAlignLeftIcon}
      hoverDataIcon="layout-align-left"
    />
  );
};

export const SidebarChromeToggle = memo(SidebarChromeToggleComponent);
SidebarChromeToggle.displayName = "SidebarChromeToggle";

import React from "react";

import { createLogger } from "@src/hooks/logger";
import { useCollapsedSidebarChromeOffset } from "@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset";
import { usePaneLayoutInsetTransition } from "@src/scaffold/AppLayout/usePaneLayoutInsetTransition";
import { CollapsedSidebarButton } from "@src/scaffold/NavigationSidebar/CollapsedSidebarButton";
import { isWindows } from "@src/util/platform/tauri";

import {
  CHAT_PANEL_HEADER_DRAG_STYLE,
  CHAT_PANEL_HEADER_NO_DRAG_STYLE,
  CHAT_PANEL_HEADER_RIGHT_PADDING_CLASS,
} from "./ChatPanelHeaderPrimitives";
import { ChatPanelPublishedHeader } from "./ChatPanelPublishedHeader";
import {
  CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX,
  CHAT_PANEL_HEADER_STACK_HEIGHT_PX,
  CHAT_PANEL_HEADER_SURFACE_CLASS,
  CHAT_PANEL_HEADER_TOP_PADDING_PX,
  CHAT_PANEL_TAB_HEADER_HEIGHT_PX,
  shouldStartHeaderDragFromTarget,
} from "./chatPanelHeaderLayout";
import type { ChatPanelHeaderSlots } from "./chatPanelHeaderSlots";

const log = createLogger("ChatPanelChrome");

export interface ChatPanelChromeProps {
  tabStrip: React.ReactNode;
  toolbar?: React.ReactNode;
  centerContent?: React.ReactNode;
  publishedHeaderSlots?: ChatPanelHeaderSlots | null;
  overlayPublishedHeader?: boolean;
  shouldOffsetHeaderForCollapsedSidebar?: boolean;
  tabRowCollapsed?: boolean;
  trailingInsetPx?: number;
}

/**
 * Platform-neutral presentation frame shared by the live desktop ChatPanel
 * and read-only transcript hosts. State ownership stays with each host; this
 * component owns only the canonical glass, tab row and published-header layout.
 */
export function ChatPanelChrome({
  tabStrip,
  toolbar,
  centerContent,
  publishedHeaderSlots = null,
  overlayPublishedHeader = false,
  shouldOffsetHeaderForCollapsedSidebar = false,
  tabRowCollapsed = false,
  trailingInsetPx,
}: ChatPanelChromeProps): React.ReactNode {
  const windowsHost = isWindows();
  const insetTransitionClassName = usePaneLayoutInsetTransition();
  const collapsedSidebarChromeOffset = useCollapsedSidebarChromeOffset();
  const collapsedSidebarChrome = shouldOffsetHeaderForCollapsedSidebar ? (
    <div
      className="z-50"
      style={CHAT_PANEL_HEADER_NO_DRAG_STYLE}
      data-testid="chat-panel-collapsed-sidebar-chrome"
    >
      <CollapsedSidebarButton />
    </div>
  ) : null;

  // Whichever row sits at the pane's top edge owns the window-edge gap, the
  // collapsed-sidebar button, and the inset that keeps the host window's own
  // controls clear of the content — the tab row's job until it folds away.
  // Padding the wrapper rather than the row keeps the row's 36px content band
  // intact, and makes it the positioning context the sidebar button centers in.
  // The window API is pulled in on interaction so it stays out of the boot graph.
  const handleCollapsedHeaderMouseDown = (
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    if (windowsHost || event.button !== 0) return;
    if (!shouldStartHeaderDragFromTarget(event.target as Element | null)) {
      return;
    }
    const maximize = event.detail === 2;
    event.preventDefault();
    void import("@src/util/platform/ipcRenderer")
      .then(({ maxWindow, startWindowDrag }) =>
        maximize ? maxWindow() : startWindowDrag()
      )
      .catch((error) => log.error("Window chrome action failed", error));
  };

  const publishedHeaderRow = tabRowCollapsed ? (
    <div
      className="workspace-header header-tab-group @container/launchpad-header relative z-40 flex shrink-0 flex-col"
      data-testid="chat-panel-collapsed-header"
      data-tauri-drag-region={windowsHost ? undefined : true}
      onMouseDown={handleCollapsedHeaderMouseDown}
      style={
        {
          paddingTop: CHAT_PANEL_HEADER_TOP_PADDING_PX,
          ...(windowsHost
            ? CHAT_PANEL_HEADER_NO_DRAG_STYLE
            : CHAT_PANEL_HEADER_DRAG_STYLE),
        } as React.CSSProperties
      }
    >
      {collapsedSidebarChrome}
      {centerContent}
      <ChatPanelPublishedHeader
        slots={publishedHeaderSlots}
        windowsHost={windowsHost}
        trailingInsetPx={trailingInsetPx}
        leadingInsetPx={
          shouldOffsetHeaderForCollapsedSidebar
            ? collapsedSidebarChromeOffset
            : undefined
        }
        insetTransitionClassName={insetTransitionClassName}
      />
    </div>
  ) : (
    <ChatPanelPublishedHeader
      slots={publishedHeaderSlots}
      windowsHost={windowsHost}
    />
  );

  return (
    <>
      <div
        className={`pointer-events-none absolute top-0 right-0 left-0 z-30 ${CHAT_PANEL_HEADER_SURFACE_CLASS}`}
        data-testid="chat-panel-header-surface"
        aria-hidden
        style={{
          height: tabRowCollapsed
            ? CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX
            : publishedHeaderSlots
              ? CHAT_PANEL_HEADER_STACK_HEIGHT_PX
              : CHAT_PANEL_TAB_HEADER_HEIGHT_PX,
        }}
      />
      {/* pl-1 (4px) + separator slot (5px) + pill px-2.5 (10px) = 19px, so the
          first tab's icon lines up with the published header's icon below
          (HEADER_CONTENT_LEFT_PADDING_CLASS 15px + breadcrumb px-1 4px). */}
      {tabRowCollapsed ? null : (
        <div
          className={`workspace-header header-tab-group @container/launchpad-header z-40 grid h-11 min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 pt-2 pl-1 ${CHAT_PANEL_HEADER_RIGHT_PADDING_CLASS} ${insetTransitionClassName} ${
            overlayPublishedHeader
              ? "absolute top-0 right-0 left-0"
              : "relative shrink-0"
          }`}
          data-testid="chat-panel-header"
          data-tauri-drag-region={windowsHost ? undefined : true}
          style={
            {
              paddingLeft: shouldOffsetHeaderForCollapsedSidebar
                ? collapsedSidebarChromeOffset
                : undefined,
              paddingRight: trailingInsetPx,
              ...(windowsHost
                ? CHAT_PANEL_HEADER_NO_DRAG_STYLE
                : CHAT_PANEL_HEADER_DRAG_STYLE),
            } as React.CSSProperties
          }
        >
          <div className="flex h-9 min-w-0 items-center">
            {collapsedSidebarChrome}
            {centerContent ? (
              <div className="flex min-w-0 flex-1 @[48rem]/launchpad-header:max-w-[30%]">
                {tabStrip}
              </div>
            ) : (
              tabStrip
            )}
          </div>
          {toolbar}
          {centerContent}
        </div>
      )}
      {overlayPublishedHeader && publishedHeaderSlots ? (
        <div
          className={`absolute right-0 left-0 z-40 ${
            tabRowCollapsed ? "top-0" : "top-11"
          }`}
        >
          {publishedHeaderRow}
        </div>
      ) : (
        publishedHeaderRow
      )}
    </>
  );
}

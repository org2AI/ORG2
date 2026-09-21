/**
 * AppLayout Component
 *
 * Consolidated shared layout for all Orgii pages.
 * Handles sidebar, content, and the docked chat panel slot.
 *
 * Chat and workbench content are flex siblings with flat, edge-to-edge
 * surfaces.
 *
 * Performance Architecture:
 * - Sidebar: DYNAMIC (changes per route via prop)
 * - Content: DYNAMIC (via children)
 * - ChatPanel: STABLE layer - stays mounted across view switches
 */
import { HoverSidebar } from "@/src/scaffold/NavigationSidebar";
import { PinnedSidebarChrome } from "@/src/scaffold/NavigationSidebar/PinnedSidebarChrome";
import { PinnedWorkbenchChrome } from "@/src/scaffold/WorkbenchChrome/PinnedWorkbenchChrome";
import { useAtomValue } from "jotai";
import React, { memo, useCallback, useEffect, useRef } from "react";

import { sendAdeActionResult } from "@src/api/tauri/agent";
import GlobalSessionSync from "@src/app/root/services/GlobalSessionSync";
import { WindowsTopBar } from "@src/components/WindowChrome";
import {
  PANE_WIDTH_TRANSITION_CLASSES,
  getChatSlotLayoutStyle,
  getPagePanelBackgroundStyle,
  getPrimaryPaneBackgroundColor,
  getResizeIndicatorHostStyle,
  getWorkbenchLayoutStyle,
} from "@src/components/layout/tokens/viewContainerTokens";
import {
  HOST_DESKTOP,
  resolveHostDesktop,
} from "@src/config/windowChromeRadius";
import { ChatProvider } from "@src/contexts/workspace/ChatContext";
import { DataProvider } from "@src/contexts/workspace/DataContext";
import ChatPanel from "@src/engines/ChatPanel";
import ChatPanelSideChat from "@src/engines/ChatPanel/SideChat";
import {
  CHAT_WIDTH_STYLE_VALUE,
  clampChatWidth,
} from "@src/engines/ChatPanel/config";
import type { SessionLaunchSuccessInfo } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/types";
import { pendingSessionProposal } from "@src/engines/SessionCore/hooks/useAgentADEActions";
import SessionSyncProvider from "@src/engines/SessionCore/sync/SessionSyncProvider";
import { SessionCreatorChatPanel } from "@src/features/SessionCreator/variants";
import type { SessionCreatorChatPanelProps } from "@src/features/SessionCreator/variants/ChatPanel";
import { dispatchWebviewLayoutChanged } from "@src/hooks/platform/useInlineWebview/webviewLayoutEvents";
import { useMacosPageBackdropSurface } from "@src/hooks/platform/useMacosPageBackdropSurface";
import {
  WorkbenchLeadingEdgeContext,
  resolveWorkbenchTouchesLeadingEdge,
} from "@src/hooks/ui/workbench/workbenchLeadingEdgeContext";
import { ActionSystemProvider } from "@src/scaffold/ActionSystem";
import { GlobalSpotlightPortal } from "@src/scaffold/GlobalSpotlight/GlobalSpotlightPortal";
import { GENERAL_LAYOUT_TOUR_TARGETS } from "@src/scaffold/Tutorials/generalLayoutTourConfig";
import { resolvedBackgroundConfigAtom } from "@src/store/ui/backgroundConfigAtom";
import { type ChatPanelMode } from "@src/store/ui/chatPanel/selectionAtoms";
import {
  DEFAULT_CHAT_WIDTH,
  chatPanelDraggingAtom,
  chatWidthAtom,
} from "@src/store/ui/chatPanel/widthAtoms";
import type { ChatPanelPosition } from "@src/store/ui/workStationLayout/chatPositionAtoms";
import { activeWorkspaceRootPathAtom } from "@src/store/workspace";

import { GlobalModals } from "./GlobalModals";

const SettingsSlot = React.lazy(
  () =>
    import(
      /* webpackChunkName: "settings-slot" */ "@src/modules/MainApp/Settings/SettingsSlot"
    )
);

// ============================================
// ADE-aware session creator slot
// ============================================

/**
 * Thin wrapper around SessionCreatorChatPanel. When there is a pending ADE
 * session.propose, launching from the creator directly resolves the Rust-side
 * tool call via sendAdeActionResult — no custom events, no Zod actions.
 */
const AdeAwareSessionCreatorSlot: React.FC<SessionCreatorChatPanelProps> = (
  props
) => {
  const handleSessionStart = useCallback(
    (info: SessionLaunchSuccessInfo) => {
      const proposal = pendingSessionProposal.current;
      if (proposal) {
        pendingSessionProposal.current = null;
        void sendAdeActionResult(proposal.correlationId, {
          success: true,
          message: `Session created: ${info.sessionId}`,
          data: { sessionId: info.sessionId },
        });
        // Dismiss the countdown card in the ADE palette.
        window.dispatchEvent(
          new CustomEvent("ade-session-proposal-resolved", {
            detail: { correlationId: proposal.correlationId },
          })
        );
      }
      props.onSessionStart?.(info);
    },
    [props]
  );

  return (
    <SessionCreatorChatPanel {...props} onSessionStart={handleSessionStart} />
  );
};

function WorkbenchActionSystemScope({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  const repoPath = useAtomValue(activeWorkspaceRootPathAtom);

  return (
    <ActionSystemProvider repoPath={repoPath}>
      {children}
      <GlobalSpotlightPortal />
    </ActionSystemProvider>
  );
}

const MAIN_CONTENT_CONTAINMENT_STYLE: React.CSSProperties = {
  contain: "layout style",
};

// ============================================
// Types
// ============================================

export interface AppLayoutProps {
  /** Current window viewport width shared with the embedded Chat Panel. */
  viewportWidth: number | undefined;
  /** Pinned sidebar component to render. */
  sidebar: React.ReactNode;

  /** Floating sidebar (shown when hovering over collapsed sidebar area) */
  floatingSidebar: React.ReactNode;

  /** Chat panel position ("left" or "right"). */
  chatPosition?: ChatPanelPosition;

  /**
   * When true, the docked chat-panel slot takes over the entire main content
   * area (the `children` view is hidden behind a zero-width workbench
   * surface). Used by the chat-panel maximize button, the narrow-viewport
   * auto-flip, and the Settings-in-slot variant.
   */
  chatPanelMaximized?: boolean;

  /**
   * What content occupies the chat-panel slot — the live session
   * (`"session"`) or the embedded Settings surface (`"settings"`). Drives
   * which component the slot renders, not its layout.
   */
  chatPanelMode?: ChatPanelMode;

  /** Content to render in the main area */
  children: React.ReactNode;
}

// ============================================
// Component
// ============================================

const AppLayoutComponent: React.FC<AppLayoutProps> = ({
  viewportWidth,
  sidebar,
  floatingSidebar,
  chatPosition = "right",
  chatPanelMaximized = false,
  chatPanelMode = "session",
  children,
}) => {
  const rawChatWidth = useAtomValue(chatWidthAtom);
  const isChatPanelDragging = useAtomValue(chatPanelDraggingAtom);
  const backgroundConfig = useAtomValue(resolvedBackgroundConfigAtom);
  const chatSlotRef = useRef<HTMLDivElement>(null);
  const paneSurfaceRef = useMacosPageBackdropSurface<HTMLDivElement>();
  const [resizeIndicatorHostElement, setResizeIndicatorHostElement] =
    React.useState<HTMLDivElement | null>(null);
  // Settings-in-slot must always have a usable width even if the user
  // previously dragged the chat to zero. Fall back to the configured
  // default so opening Settings never produces a collapsed slot.
  const isSettingsSlot = chatPanelMode === "settings";
  const effectiveRawWidth =
    rawChatWidth > 0 ? rawChatWidth : isSettingsSlot ? DEFAULT_CHAT_WIDTH : 0;
  const chatWidth = clampChatWidth(effectiveRawWidth, viewportWidth);
  const chatWidthStyleValue = chatWidth > 0 ? CHAT_WIDTH_STYLE_VALUE : 0;
  const isChatOnLeft = chatPosition === "left";
  const isChatVisible = chatPanelMaximized || chatWidth > 0;
  // Settings doesn't have a "session" to render — when the slot is in
  // settings mode it must always be visible regardless of `chatWidth`
  // (otherwise an existing zero-width chat would hide the settings panel
  // too).
  const isSlotVisible = chatPanelMode === "settings" ? true : isChatVisible;
  const workbenchTouchesLeadingEdge = resolveWorkbenchTouchesLeadingEdge({
    chatSlotMaximized: chatPanelMaximized,
    chatSlotVisible: isSlotVisible,
    chatSlotOnLeft: isChatOnLeft,
  });
  const settingsSurfaceStyle = getPagePanelBackgroundStyle(
    backgroundConfig.pageOpacity
  );
  const paneUnderlayStyle: React.CSSProperties = {
    backgroundColor: getPrimaryPaneBackgroundColor(
      backgroundConfig.pageOpacity
    ),
  };
  const paneTransitionClassName = isChatPanelDragging
    ? ""
    : PANE_WIDTH_TRANSITION_CLASSES;
  const chatSlotStyle = getChatSlotLayoutStyle({
    maximized: chatPanelMaximized,
    visible: isSlotVisible,
    visibleWidth: chatWidthStyleValue,
  });
  const workbenchStyle = getWorkbenchLayoutStyle(chatPanelMaximized);
  const handlePaneTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.currentTarget !== event.target) return;
      dispatchWebviewLayoutChanged();
    },
    []
  );

  useEffect(() => {
    dispatchWebviewLayoutChanged();
  }, [chatPosition, chatPanelMaximized, chatWidth, isSlotVisible]);

  useEffect(() => {
    if (isSlotVisible) return;
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      chatSlotRef.current?.contains(activeElement)
    ) {
      activeElement.blur();
    }
  }, [isSlotVisible]);

  // Slot content: either the live chat panel or the in-slot Settings surface.
  // Both share the slot's outer maximize/inset behaviour — only the inner
  // component differs.
  const slotInner =
    chatPanelMode === "settings" ? (
      <React.Suspense
        fallback={
          <div
            data-settings-loading-surface
            className="h-full w-full"
            style={settingsSurfaceStyle}
          />
        }
      >
        <SettingsSlot
          maximized={chatPanelMaximized}
          position={chatPosition}
          resizeIndicatorHost={resizeIndicatorHostElement}
        />
      </React.Suspense>
    ) : (
      <ChatPanel
        viewportWidth={viewportWidth}
        useExternalWidth={chatPanelMaximized}
        position={chatPosition}
        resizeIndicatorHost={resizeIndicatorHostElement}
        sessionCreatorSlot={AdeAwareSessionCreatorSlot}
      />
    );

  // The slot stays mounted at zero width so close/open can animate.
  const chatSlot = (
    <div
      key="chat-slot"
      ref={chatSlotRef}
      className={`relative z-10 flex min-h-0 min-w-0 overflow-hidden ${paneTransitionClassName}`}
      style={chatSlotStyle}
      aria-hidden={!isSlotVisible}
      data-fullmode-chat-wrapper
      data-tour-target={
        chatPanelMode === "session"
          ? GENERAL_LAYOUT_TOUR_TARGETS.chatPanel
          : undefined
      }
      data-chat-focus={chatPanelMaximized || undefined}
      data-chat-slot-mode={chatPanelMode}
      onTransitionEnd={handlePaneTransitionEnd}
    >
      {slotInner}
    </div>
  );

  const resizeIndicatorHost = !chatPanelMaximized ? (
    <div
      key="chat-workstation-resize-indicator-host"
      ref={setResizeIndicatorHostElement}
      className="pointer-events-none relative z-80 w-0 flex-none self-stretch overflow-visible"
      style={getResizeIndicatorHostStyle(chatPosition)}
      data-chat-workstation-resize-indicator-host
      aria-hidden
    />
  ) : null;

  // Shared content wrapped in providers
  const contentArea = (
    <DataProvider>
      <ChatProvider>
        <SessionSyncProvider>
          <GlobalSessionSync />

          <div
            className="min-h-0 min-w-0 flex-1 overflow-hidden"
            data-main-content
          >
            <div
              ref={paneSurfaceRef}
              className="relative isolate flex h-full min-h-0 min-w-0 flex-row overflow-hidden"
              style={paneUnderlayStyle}
              data-pane-surface-underlay
            >
              {isChatOnLeft && chatSlot}
              {isChatOnLeft && resizeIndicatorHost}
              <div
                key="workbench-surface"
                // Animate the real flex track to zero so inline native
                // webviews and ResizeObserver consumers see the exact width
                // throughout focus/unfocus instead of an overlay swap.
                className={`relative z-0 h-full min-h-0 min-w-0 overflow-hidden ${paneTransitionClassName}`}
                style={workbenchStyle}
                aria-hidden={chatPanelMaximized}
                data-find-scope-switching={
                  isSlotVisible && isChatOnLeft && !chatPanelMaximized
                }
                data-workbench-surface
                onTransitionEnd={handlePaneTransitionEnd}
              >
                <WorkbenchLeadingEdgeContext.Provider
                  value={workbenchTouchesLeadingEdge}
                >
                  <WorkbenchActionSystemScope>
                    {children}
                  </WorkbenchActionSystemScope>
                </WorkbenchLeadingEdgeContext.Provider>
              </div>
              {!isChatOnLeft && resizeIndicatorHost}
              {!isChatOnLeft && chatSlot}
              {/* Global floating side chat: hosted over the whole pane
                  surface (chat slot + workbench), so it stays usable when
                  the chat pane is hidden and a station fills the view. */}
              {!isSettingsSlot && (
                <ChatPanelSideChat
                  SessionCreatorSlot={AdeAwareSessionCreatorSlot}
                />
              )}
            </div>
          </div>
        </SessionSyncProvider>
      </ChatProvider>
    </DataProvider>
  );

  // Same host resolution as SidebarBase: browser mode is never a Windows host.
  const windowsHost = resolveHostDesktop() === HOST_DESKTOP.WINDOWS;

  return (
    <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col">
      {windowsHost && <WindowsTopBar />}
      <div className="flex min-h-0 min-w-0 flex-1">
        <HoverSidebar.Trigger />
        <PinnedSidebarChrome />
        <PinnedWorkbenchChrome />
        {sidebar}

        <HoverSidebar.Container>{floatingSidebar}</HoverSidebar.Container>

        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col ${
            windowsHost ? "windows-main-page-underlay" : ""
          }`}
        >
          <div
            className={`relative flex h-full min-h-0 flex-1 flex-col ${
              windowsHost ? "windows-main-page-surface" : ""
            }`}
            // Containment keeps layout thrash from propagating during page
            // transitions.
            style={MAIN_CONTENT_CONTAINMENT_STYLE}
          >
            {contentArea}
          </div>

          <GlobalModals />
        </div>
      </div>
    </div>
  );
};

AppLayoutComponent.displayName = "AppLayout";

export const AppLayout = memo(AppLayoutComponent);

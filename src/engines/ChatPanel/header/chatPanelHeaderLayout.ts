export const CHAT_PANEL_TAB_HEADER_HEIGHT_PX = 44;
export const CHAT_PANEL_PUBLISHED_HEADER_HEIGHT_PX = 36;
/**
 * Gap above whichever header row sits at the pane's top edge — the tab row's
 * `pt-2`. It keeps the row clear of the window edge and lines the row's
 * content band up with the host window controls beside it, so the row that
 * inherits the top edge has to inherit the gap too.
 */
export const CHAT_PANEL_HEADER_TOP_PADDING_PX = 8;
/** Collapsed chrome: the published row plus the top gap it inherited. */
export const CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX =
  CHAT_PANEL_PUBLISHED_HEADER_HEIGHT_PX + CHAT_PANEL_HEADER_TOP_PADDING_PX;
export const CHAT_PANEL_HEADER_STACK_HEIGHT_PX =
  CHAT_PANEL_TAB_HEADER_HEIGHT_PX + CHAT_PANEL_PUBLISHED_HEADER_HEIGHT_PX;
export const CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX = 24;
export const CHAT_PANEL_TRANSCRIPT_TOP_PADDING_PX =
  CHAT_PANEL_HEADER_STACK_HEIGHT_PX + CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX;

/**
 * Solid surface shared by the chat header stack and its pinned subheaders.
 * Deliberately opaque and blur-free: a `backdrop-filter` here is re-rendered
 * by WebKit every frame the transcript scrolls underneath it, on top of the
 * native window material that already blurs behind the window.
 */
export const CHAT_PANEL_HEADER_SURFACE_CLASS = "bg-chat-pane";

interface ChatPanelHeaderOverlayState {
  showSessionContent: boolean;
  standaloneToolTabActive: boolean;
  humanSessionActive: boolean;
}

/** Transcript top padding: the chrome share moves to the pinned-header host when it renders in flow. */
export function resolveTranscriptTopPaddingPx(
  chromeTopInset: number,
  pinnedHeaderLayerInFlow: boolean
): number {
  if (chromeTopInset > 0 && pinnedHeaderLayerInFlow) {
    return CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX;
  }
  // A collapsed header stack floats less chrome, so the transcript reserves
  // the inset it was actually given rather than the full two-row height.
  const floatingChromePx =
    chromeTopInset > 0 ? chromeTopInset : CHAT_PANEL_HEADER_STACK_HEIGHT_PX;
  return floatingChromePx + CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX;
}

/** Minimum split-pane width for title and controls to share one row. */
export const CHAT_PANEL_COMPACT_HEADER_MIN_WIDTH_PX = 640;

interface ChatPanelTabRowCollapseState {
  tabCount: number;
  splitPaneWidth?: number;
}

/**
 * Fold a single tab into the published header only when there is room.
 * Narrow split panes keep the tab controls above the session heading; the
 * same decision also drives the shell and transcript's header reservations.
 * Maximized and externally sized surfaces omit splitPaneWidth.
 */
export function shouldCollapseChatPanelTabRow({
  tabCount,
  splitPaneWidth,
}: ChatPanelTabRowCollapseState): boolean {
  return (
    tabCount === 1 &&
    (splitPaneWidth === undefined ||
      splitPaneWidth >= CHAT_PANEL_COMPACT_HEADER_MIN_WIDTH_PX)
  );
}

/**
 * Controls the folded header must never drag the window out from under.
 */
const HEADER_INTERACTIVE_SELECTOR =
  'button,a,input,select,textarea,[role="button"],[role="menuitem"],[role="tab"],[contenteditable="true"]';

/**
 * Whether a mousedown on the folded header should start a window drag.
 *
 * Tauri matches `data-tauri-drag-region` on the event target alone and never
 * walks ancestors, so only the exact element under the cursor counts. In this
 * row that element is never the one carrying the attribute: the content slot
 * stretches over the whole row, and the session breadcrumb inside it is a
 * `container-type: inline-size` element, which cannot be shrunk to its content
 * to free the space up — containment makes it contribute zero width, so it
 * collapses and takes the title with it. The folded row therefore drives the
 * drag itself and steps aside only for things the user can actually click.
 */
export function shouldStartHeaderDragFromTarget(
  target: Element | null
): boolean {
  return Boolean(target) && !target?.closest(HEADER_INTERACTIVE_SELECTOR);
}

/** Floating-chrome height the transcript scrolls beneath. */
export function resolveChatPanelChromeTopInsetPx(
  overlayHeaders: boolean,
  tabRowCollapsed: boolean
): number {
  if (!overlayHeaders) return 0;
  return tabRowCollapsed
    ? CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX
    : CHAT_PANEL_HEADER_STACK_HEIGHT_PX;
}

/** Session views share one floating-header contract in the chat pane. */
export function shouldOverlayChatSessionHeaders({
  showSessionContent,
  standaloneToolTabActive,
  humanSessionActive,
}: ChatPanelHeaderOverlayState): boolean {
  return showSessionContent && !standaloneToolTabActive && !humanSessionActive;
}

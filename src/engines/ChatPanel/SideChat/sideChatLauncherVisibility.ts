/**
 * Which pane surfaces get the floating side-chat launcher.
 *
 * The launcher only earns its corner on surfaces that carry no chat of their
 * own; the per-type decision lives in `CHAT_PANEL_TAB_TYPE_POLICY`. This
 * gates the button only. An already-open side chat keeps floating across
 * tab switches — it is a picture-in-picture window the user placed, not a
 * property of the surface underneath it.
 */
import {
  CHAT_PANEL_TAB_TYPE_POLICY,
  type ChatPanelTabType,
} from "@src/store/chatPanel/chatPanelTabsModel";

/**
 * `null` (no active tab) reads as hidden: the pane re-seeds a launchpad tab
 * whenever the last one closes, so an empty pane is a launchpad in waiting.
 */
export function shouldShowSideChatLauncher(
  tabType: ChatPanelTabType | null | undefined
): boolean {
  return (
    tabType != null && CHAT_PANEL_TAB_TYPE_POLICY[tabType].sideChatLauncher
  );
}

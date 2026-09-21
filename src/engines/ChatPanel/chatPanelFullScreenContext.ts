import { createContext } from "react";

/**
 * Whether the enclosing ChatPanel currently fills the app window (maximized,
 * or forced to full width by its active tab). Composers rendered anywhere
 * else — workstation tabs, the side chat, detached session and station
 * windows — read the default and keep the full-size editor.
 */
export const ChatPanelFullScreenContext = createContext(false);

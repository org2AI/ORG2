/**
 * Chat panel width atoms.
 *
 * High-frequency state for the chat pane's dimensions. Jotai instead of
 * Context to avoid excessive re-rendering.
 *
 * This module owns module-level mutable state (`chatWidthSaveTimer`,
 * `lastVisibleChatWidth`) and runs `getInitialChatWidth()` once at import
 * time to seed the atom. AppProviders explicitly initializes the CSS variable
 * from its store before rendering children. Keep the storage and atom owner together.
 */
import { atom, type createStore } from "jotai";
import { z } from "zod/v4";

import {
  DEFAULT_CHAT_SPLIT_RATIO,
  clampChatWidth,
  clampVisibleChatWidth,
  getChatWidthForRatio,
} from "@src/engines/ChatPanel/config";

/**
 * Chat width - persisted across sessions
 * Now unified across all views (workstation, session workspace, kanban)
 *
 * The stored value is a dragged pixel width and always wins once it exists.
 * The `general.chatPaneSplitRatio` preset supplies the width when there is no
 * stored one (first run) and whenever the user picks a preset, via
 * `adoptDefaultChatWidthAtom` — see `splitRatioAtoms.ts`.
 *
 * OPTIMIZED: Uses debounced localStorage writes to prevent blocking UI
 */

/**
 * Fallback width for callers that need one without a window to measure —
 * SSR/test imports, and the Settings-in-slot pane, which is not part of the
 * station/chat split the ratio preset describes.
 */
export const DEFAULT_CHAT_WIDTH = 520;

// Debounce timer for localStorage writes
let chatWidthSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastVisibleChatWidth = DEFAULT_CHAT_WIDTH;
const CHAT_WIDTH_SAVE_DELAY = 300; // ms

// CSS variable name for direct DOM updates
const CHAT_WIDTH_CSS_VAR = "--orgii-chat-width";
// Clamp persisted widths to the current responsive range; preserve the 0
// sentinel which means "chat panel hidden".
const ChatWidthSchema = z.number().transform((value) => {
  if (value <= 0) return 0;
  return clampVisibleChatWidth(value);
});

// Load initial value from localStorage (only once at startup).
// Clamp to the responsive width range so values persisted from wider viewports
// don't overflow, and immediately write the clamped value back so the next
// reload is clean.
const getInitialChatWidth = (): number => {
  if (typeof window === "undefined") return DEFAULT_CHAT_WIDTH;
  // Settings hydrate from disk asynchronously, so a first run cannot read the
  // user's own preset here — but a first run is precisely the case where the
  // setting still holds its schema default, so the two agree.
  const seedWidth = getChatWidthForRatio(DEFAULT_CHAT_SPLIT_RATIO);
  try {
    const storedValue = localStorage.getItem("globalChatWidth");
    const parsed = storedValue !== null ? JSON.parse(storedValue) : seedWidth;
    const width = ChatWidthSchema.safeParse(parsed).data ?? seedWidth;
    if (width !== parsed) {
      localStorage.setItem("globalChatWidth", JSON.stringify(width));
    }
    return width;
  } catch {
    localStorage.setItem("globalChatWidth", JSON.stringify(seedWidth));
    return seedWidth;
  }
};

// Read the persisted width once for the canonical atom.
const initialChatWidth = getInitialChatWidth();
lastVisibleChatWidth =
  initialChatWidth > 0 ? initialChatWidth : DEFAULT_CHAT_WIDTH;
// Base atom for in-memory state (fast updates, no persistence)
const chatWidthBaseAtom = atom<number>(initialChatWidth);
chatWidthBaseAtom.debugLabel = "chatWidthBaseAtom";

/** True only while the user is actively resizing the chat pane. */
export const chatPanelDraggingAtom = atom<boolean>(false);
chatPanelDraggingAtom.debugLabel = "chatPanelDraggingAtom";

/**
 * Chat width atom with optimized persistence
 * - Reads from base atom (fast)
 * - Writes update base atom immediately + debounced localStorage write
 * - Also updates CSS variable directly for instant visual feedback
 */
export const chatWidthAtom = atom(
  (get) => get(chatWidthBaseAtom),
  (_get, set, newWidth: number) => {
    const clampedWidth = clampChatWidth(newWidth);

    set(chatWidthBaseAtom, clampedWidth);

    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty(
        CHAT_WIDTH_CSS_VAR,
        `${clampedWidth}px`
      );
    }

    if (clampedWidth <= 0) return;

    rememberVisibleChatWidth(clampedWidth);
  }
);
chatWidthAtom.debugLabel = "chatWidthAtom";

/** Record a visible width as the one to restore to, and persist it (debounced). */
function rememberVisibleChatWidth(width: number): void {
  lastVisibleChatWidth = width;
  if (chatWidthSaveTimer) {
    clearTimeout(chatWidthSaveTimer);
  }
  chatWidthSaveTimer = setTimeout(() => {
    localStorage.setItem("globalChatWidth", JSON.stringify(width));
    chatWidthSaveTimer = null;
  }, CHAT_WIDTH_SAVE_DELAY);
}

/**
 * Adopt `width` as the pane's width: applied immediately when the pane is
 * open, and stored as the width it reopens at when it is hidden. Used by the
 * split-ratio preset, which must land even from a station whose chat pane is
 * currently collapsed.
 */
export const adoptDefaultChatWidthAtom = atom(
  null,
  (get, set, width: number) => {
    const clampedWidth = clampVisibleChatWidth(width);
    if (get(chatWidthBaseAtom) > 0) {
      set(chatWidthAtom, clampedWidth);
      return;
    }
    rememberVisibleChatWidth(clampedWidth);
  }
);
adoptDefaultChatWidthAtom.debugLabel = "adoptDefaultChatWidthAtom";

export const restoreChatWidthAtom = atom(null, (_get, set) => {
  set(chatWidthAtom, lastVisibleChatWidth || DEFAULT_CHAT_WIDTH);
});
restoreChatWidthAtom.debugLabel = "restoreChatWidthAtom";

/**
 * Derived atom for chat visibility only
 * OPTIMIZED: Only triggers re-render when visibility changes (0 <-> non-zero)
 * Components that only need to know if chat is visible should use this
 */
export const chatVisibleAtom = atom((get) => get(chatWidthBaseAtom) > 0);
chatVisibleAtom.debugLabel = "chatVisibleAtom";

/** Initialize the window CSS from the app store before its children render. */
export function initializeChatWidthStyles(
  store: Pick<ReturnType<typeof createStore>, "get">
): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    CHAT_WIDTH_CSS_VAR,
    `${store.get(chatWidthAtom)}px`
  );
}

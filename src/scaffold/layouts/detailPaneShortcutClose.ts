import { createContext } from "react";

/**
 * What the close-tab chord does to an open detail when that differs from the
 * pane's "x". Inbox's "x" collapses the pane into the full-width list; the
 * chord only clears the selection, so the split and its placeholder stay.
 * Surfaces without a provider run their "x" handler.
 */
export const DetailPaneShortcutCloseContext = createContext<
  (() => void) | null
>(null);
DetailPaneShortcutCloseContext.displayName = "DetailPaneShortcutCloseContext";

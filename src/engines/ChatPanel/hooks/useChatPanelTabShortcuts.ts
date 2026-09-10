import { useAtomValue, useSetAtom } from "jotai";
import { type RefObject, useCallback, useEffect, useRef } from "react";

import { matchesShortcut } from "@src/config/keyboard/shortcutBindings";
import {
  closeAndDestroyChatPanelTabAtom,
  nextChatPanelTabAtom,
  prevChatPanelTabAtom,
} from "@src/store/chatPanel/chatPanelTabLifecycleAtoms";
import {
  goBackChatPanelTabAtom,
  goForwardChatPanelTabAtom,
} from "@src/store/chatPanel/chatPanelTabNavigationAtoms";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";

import { resolveChatPanelShortcutOwnership } from "./chatPanelShortcutOwnership";

export interface UseChatPanelTabShortcutsOptions {
  onNewSession: () => void;
  onNewTerminal: () => void;
  /** Ref to the outermost chat panel container for focus-scoped keyboard handling */
  containerRef?: RefObject<HTMLElement | null>;
}

/**
 * Chat-panel-scoped tab shortcuts plus the global "create-chat-tab" event.
 * Mounted by ChatPanel unconditionally so the shortcuts work even when the
 * visual tab strip is not rendered. Bracket bindings follow the browser
 * convention the editor already uses: ⌘[ / ⌘] walk the active tab's session
 * history, ⇧⌘[ / ⇧⌘] switch tabs.
 */
export function useChatPanelTabShortcuts({
  onNewSession,
  onNewTerminal,
  containerRef,
}: UseChatPanelTabShortcutsOptions): void {
  const state = useAtomValue(chatPanelTabsAtom);
  const isChatPanelMaximized = useAtomValue(chatPanelMaximizedAtom);
  const closeTab = useSetAtom(closeAndDestroyChatPanelTabAtom);
  const nextTab = useSetAtom(nextChatPanelTabAtom);
  const prevTab = useSetAtom(prevChatPanelTabAtom);
  const goBack = useSetAtom(goBackChatPanelTabAtom);
  const goForward = useSetAtom(goForwardChatPanelTabAtom);

  const tabsRef = useRef(state);
  const paneOwnsShortcutsRef = useRef(containerRef === undefined);
  useEffect(() => {
    tabsRef.current = state;
  }, [state]);

  useEffect(() => {
    if (containerRef === undefined) {
      paneOwnsShortcutsRef.current = true;
      return undefined;
    }

    const updatePaneOwnership = (target: EventTarget | null) => {
      paneOwnsShortcutsRef.current = resolveChatPanelShortcutOwnership(
        containerRef.current,
        target,
        paneOwnsShortcutsRef.current
      );
    };
    const handlePointerDown = (event: PointerEvent) => {
      updatePaneOwnership(event.target);
    };
    const handleFocusIn = (event: FocusEvent) => {
      updatePaneOwnership(event.target);
    };

    updatePaneOwnership(document.activeElement);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("focusin", handleFocusIn, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [containerRef]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isChatPanelMaximized && !paneOwnsShortcutsRef.current) return;

      if (matchesShortcut(event, "close_tab")) {
        const active = tabsRef.current.tabs.find(
          (tab) => tab.id === tabsRef.current.activeTabId
        );
        if (active) {
          event.preventDefault();
          event.stopPropagation();
          void closeTab(active.id);
        }
        return;
      }
      const navigation = [
        ["chat_next_tab", nextTab],
        ["chat_prev_tab", prevTab],
        ["chat_go_forward", goForward],
        ["chat_go_back", goBack],
      ] as const;
      const action = navigation.find(([id]) => matchesShortcut(event, id));
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        action[1]();
        return;
      }
      if (matchesShortcut(event, "new_session")) {
        event.preventDefault();
        event.stopPropagation();
        onNewSession();
      }
    },
    [
      closeTab,
      goBack,
      goForward,
      isChatPanelMaximized,
      nextTab,
      onNewSession,
      prevTab,
    ]
  );

  useEffect(() => {
    // Capture before the app-wide WorkStation listener on `document`, so a
    // focused/maximized chat pane owns its tab shortcuts without also closing
    // the underlying WorkStation tab.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  useEffect(() => {
    const handler = () => onNewTerminal();
    window.addEventListener("create-chat-tab", handler);
    return () => window.removeEventListener("create-chat-tab", handler);
  }, [onNewTerminal]);
}

import { atom } from "jotai";

import { chatPanelTabsAtom } from "./chatPanelTabsState";

/** Transient, single-slot content beside a conversation; never a Station tab. */
export type ChatPanelCompanion = {
  type: "session-sources";
  sessionId: string;
  ownerTabId: string;
};

export const chatPanelCompanionAtom = atom<ChatPanelCompanion | null>(null);

/** Only the active conversation may open its companion. Repeated opens are inert. */
export const openChatPanelSourcesAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const id = sessionId.trim();
    const tabs = get(chatPanelTabsAtom);
    const owner = tabs.tabs.find((tab) => tab.id === tabs.activeTabId);
    if (!id || owner?.type !== "session" || owner.sessionId !== id) return;
    const current = get(chatPanelCompanionAtom);
    if (current?.ownerTabId === owner.id && current.sessionId === id) return;
    set(chatPanelCompanionAtom, {
      type: "session-sources",
      sessionId: id,
      ownerTabId: owner.id,
    });
  }
);

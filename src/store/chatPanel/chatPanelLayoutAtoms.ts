import { atom } from "jotai";

import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";

import { resolveChatPanelMaximizedForLayout } from "./chatPanelTabsModel";
import { activeChatPanelTabAtom } from "./chatPanelTabsState";

/** Effective layout only; writes continue to target the saved preference. */
export const effectiveChatPanelMaximizedAtom = atom((get) =>
  resolveChatPanelMaximizedForLayout(
    get(chatPanelMaximizedAtom),
    get(activeChatPanelTabAtom)
  )
);
effectiveChatPanelMaximizedAtom.debugLabel = "effectiveChatPanelMaximized";

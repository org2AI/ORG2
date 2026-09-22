/**
 * Start-page (Launchpad) tab open atoms.
 */
import { atom } from "jotai";

import {
  type ChatPanelCreateProjectContext,
  type ChatPanelCreateTarget,
  chatPanelCreateProjectContextAtom,
  chatPanelCreateTargetAtom,
  chatPanelStartPageOpenAtom,
} from "@src/store/ui/chatPanel/selectionAtoms";

import { createLaunchpadTab } from "../chatPanelTabFactories";
import { openOrFocusChatPanelTab } from "./openOrFocus";

interface OpenOrFocusStartPageTabOptions {
  title?: string;
}

/**
 * Focus the singleton Launchpad start-page tab, or create it when none is
 * open. This is the one entry point new-session and
 * launchpad triggers should use so they reuse the existing tab instead of
 * stacking duplicates.
 */
export const openOrFocusChatPanelStartPageTabAtom = atom(
  null,
  (get, set, options: OpenOrFocusStartPageTabOptions = {}) => {
    const { title = "Launchpad" } = options;
    return openOrFocusChatPanelTab(get, set, {
      isMatch: (tab) => tab.type === "start-page",
      create: () => createLaunchpadTab({ title }),
    });
  }
);
openOrFocusChatPanelStartPageTabAtom.debugLabel =
  "openOrFocusChatPanelStartPageTab";

interface OpenCreateTargetInStartPageOptions {
  target: ChatPanelCreateTarget;
  title?: string;
  createProjectContext?: ChatPanelCreateProjectContext | null;
}

/** Focus Launchpad and show a creator inside its pinned inner navigation. */
export const openCreateTargetInChatPanelStartPageAtom = atom(
  null,
  (_get, set, options: OpenCreateTargetInStartPageOptions) => {
    const tabId = set(openOrFocusChatPanelStartPageTabAtom, {
      title: options.title,
    });
    set(chatPanelCreateTargetAtom, options.target);
    set(
      chatPanelCreateProjectContextAtom,
      options.createProjectContext ?? null
    );
    set(chatPanelStartPageOpenAtom, true);
    return tabId;
  }
);
openCreateTargetInChatPanelStartPageAtom.debugLabel =
  "openCreateTargetInChatPanelStartPage";

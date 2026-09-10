import { atom } from "jotai";

import { ROUTES } from "@src/config/routes";
import type {
  ChatPanelCreateProjectContext,
  ChatPanelCreateTarget,
} from "@src/store/ui/chatPanel/selectionAtoms";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationChatVisibilityAtom } from "@src/store/ui/chatPanel/visibilityAtoms";
import { chatWidthAtom } from "@src/store/ui/chatPanel/widthAtoms";
import { manualCreatorAtom } from "@src/store/ui/manualCreatorAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { spotlightOpenAtom } from "@src/store/ui/uiAtom";

import { openCreateTargetInChatPanelStartPageAtom } from "./chatPanelTabOpen/startPage";
import { activeChatPanelTabAtom } from "./chatPanelTabsState";

/** Preserve visible Launchpad creation; use Spotlight from other pages. */
export const openChatPanelCreateTargetAtom = atom(
  null,
  (
    get,
    set,
    options: {
      target: ChatPanelCreateTarget;
      title?: string;
      createProjectContext?: ChatPanelCreateProjectContext | null;
    }
  ) => {
    const pathname =
      typeof window === "undefined" ? "" : window.location.pathname;
    const workstationPath = ROUTES.workStation.base.path;
    const inWorkstation =
      pathname === workstationPath ||
      pathname.startsWith(workstationPath + "/");
    const launchpadVisible =
      inWorkstation &&
      get(activeChatPanelTabAtom)?.type === "start-page" &&
      (get(chatPanelMaximizedAtom) ||
        (get(stationChatVisibilityAtom)[get(stationModeAtom)] &&
          get(chatWidthAtom) > 0));
    if (
      !launchpadVisible &&
      (options.target === "project" || options.target === "workItem")
    ) {
      set(spotlightOpenAtom, false);
      set(manualCreatorAtom, {
        target: options.target,
        createProjectContext: options.createProjectContext,
      });
      return;
    }
    set(manualCreatorAtom, null);
    set(openCreateTargetInChatPanelStartPageAtom, options);
  }
);

/**
 * Default split between the station (My Station / Agent Station) and the chat
 * pane.
 *
 * The preset is a default, not a constraint. Picking one applies it at once —
 * that is the whole feedback the control gives — but the divider stays free
 * afterwards, and the dragged pixel width is what persists. One value is
 * shared by both stations, matching the single global chat width.
 */
import { atom } from "jotai";

import {
  type ChatSplitRatio,
  getChatWidthForRatio,
} from "@src/engines/ChatPanel/config";
import { createLogger } from "@src/hooks/logger";
import { settingsAtom, updateSettingAtom } from "@src/store/settings";

import { adoptDefaultChatWidthAtom } from "./widthAtoms";

const log = createLogger("ChatSplitRatio");

export const chatSplitRatioAtom = atom(
  (get) => get(settingsAtom)["general.chatPaneSplitRatio"] as ChatSplitRatio,
  (_get, set, value: ChatSplitRatio) => {
    set(updateSettingAtom, {
      key: "general.chatPaneSplitRatio",
      value,
    }).catch((error: unknown) => {
      log.warn("Failed to persist general.chatPaneSplitRatio:", error);
    });
    set(adoptDefaultChatWidthAtom, getChatWidthForRatio(value));
  }
);
chatSplitRatioAtom.debugLabel = "chatSplitRatio";

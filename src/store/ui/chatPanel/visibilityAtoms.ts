/**
 * Per-Station chat visibility.
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import type { StationMode } from "@src/types/ui/workstation";
import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

import { chatWidthAtom, restoreChatWidthAtom } from "./widthAtoms";

const StationChatVisibilitySchema = z.object({
  "my-station": z.boolean(),
  "agent-station": z.boolean(),
});

export type StationChatVisibility = z.infer<typeof StationChatVisibilitySchema>;

export const stationChatVisibilityAtom = atomWithStorage<StationChatVisibility>(
  "stationChatVisibility",
  {
    "my-station": true,
    "agent-station": true,
  },
  createZodJsonStorage(StationChatVisibilitySchema),
  { getOnInit: true }
);
stationChatVisibilityAtom.debugLabel = "stationChatVisibilityAtom";

/** Write-only: show or hide one station's chat pane. */
export const activeStationChatVisibleAtom = atom(
  null,
  (_get, set, mode: StationMode, visible: boolean) => {
    set(stationChatVisibilityAtom, (prev) => ({
      ...prev,
      [mode]: visible,
    }));
    if (visible) {
      set(restoreChatWidthAtom);
    } else {
      set(chatWidthAtom, 0);
    }
  }
);
activeStationChatVisibleAtom.debugLabel = "activeStationChatVisibleAtom";

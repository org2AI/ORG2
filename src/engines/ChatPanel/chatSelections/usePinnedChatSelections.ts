/**
 * Read/write access to a session's pinned transcript passages. The transcript
 * writes pins; the workstation trail reads and removes them.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";

import {
  EMPTY_PINNED_SELECTIONS,
  hydratePinnedChatSelectionsAtom,
  pinChatSelectionAtom,
  pinnedChatSelectionsAtom,
  unpinChatSelectionAtom,
} from "./chatSelectionAtoms";
import type { PinnedChatSelection } from "./pinnedSelections";

export interface UsePinnedChatSelectionsResult {
  pins: PinnedChatSelection[];
  pin: (text: string, anchorId?: string) => void;
  unpin: (id: string) => void;
}

export function usePinnedChatSelections(
  sessionId: string | null | undefined
): UsePinnedChatSelectionsResult {
  const hydrate = useSetAtom(hydratePinnedChatSelectionsAtom);
  const pinSelection = useSetAtom(pinChatSelectionAtom);
  const unpinSelection = useSetAtom(unpinChatSelectionAtom);
  const pinsBySession = useAtomValue(pinnedChatSelectionsAtom);

  useEffect(() => {
    if (!sessionId) return;
    hydrate(sessionId);
  }, [hydrate, sessionId]);

  const pin = useCallback(
    (text: string, anchorId?: string) => {
      if (!sessionId) return;
      pinSelection({ sessionId, text, anchorId });
    },
    [pinSelection, sessionId]
  );

  const unpin = useCallback(
    (id: string) => {
      if (!sessionId) return;
      unpinSelection({ sessionId, id });
    },
    [sessionId, unpinSelection]
  );

  return {
    pins: (sessionId && pinsBySession[sessionId]) || EMPTY_PINNED_SELECTIONS,
    pin,
    unpin,
  };
}

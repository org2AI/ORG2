/**
 * The passage the composer is currently replying to. Written by the
 * transcript's selection menu and by pinned rows in the trail; read by the
 * composer chip and cleared on send.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

import {
  chatQuotedSelectionsAtom,
  clearChatQuotedSelectionAtom,
  setChatQuotedSelectionAtom,
} from "./chatSelectionAtoms";

export interface UseChatQuotedSelectionResult {
  quotedText: string | undefined;
  quoteSelection: (text: string) => void;
  clearQuotedSelection: () => void;
}

export function useChatQuotedSelection(
  sessionId: string | null | undefined
): UseChatQuotedSelectionResult {
  const quotes = useAtomValue(chatQuotedSelectionsAtom);
  const setQuote = useSetAtom(setChatQuotedSelectionAtom);
  const clearQuote = useSetAtom(clearChatQuotedSelectionAtom);

  const quoteSelection = useCallback(
    (text: string) => {
      if (!sessionId) return;
      setQuote({ sessionId, text });
    },
    [sessionId, setQuote]
  );

  const clearQuotedSelection = useCallback(() => {
    if (!sessionId) return;
    clearQuote(sessionId);
  }, [clearQuote, sessionId]);

  return {
    quotedText: sessionId ? quotes[sessionId] : undefined,
    quoteSelection,
    clearQuotedSelection,
  };
}

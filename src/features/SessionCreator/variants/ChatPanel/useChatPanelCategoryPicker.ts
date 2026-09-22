/**
 * SessionCreatorChatPanel — category picker open state.
 *
 * Local open/closed state for the dispatch-category picker, plus the anchor
 * ref of the agent hero it is positioned against. The global
 * `openCategoryPickerSignalAtom` is consumed as an edge: each new signal value
 * opens the picker once.
 */
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";

import { openCategoryPickerSignalAtom } from "@src/store/session/openCategoryPickerAtom";

export function useChatPanelCategoryPicker() {
  const [isCategorySelectorOpen, setIsCategorySelectorOpen] = useState(false);
  const openCategoryPickerSignal = useAtomValue(openCategoryPickerSignalAtom);
  const prevOpenCategoryPickerSignalRef = useRef(openCategoryPickerSignal);
  useEffect(() => {
    if (openCategoryPickerSignal !== prevOpenCategoryPickerSignalRef.current) {
      prevOpenCategoryPickerSignalRef.current = openCategoryPickerSignal;
      // Defer out of the effect body to avoid synchronous setState cascades
      queueMicrotask(() => setIsCategorySelectorOpen(true));
    }
  }, [openCategoryPickerSignal]);

  const agentHeroRef = useRef<HTMLButtonElement>(null);

  return { isCategorySelectorOpen, setIsCategorySelectorOpen, agentHeroRef };
}

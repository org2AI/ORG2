import { type MutableRefObject, useCallback, useState } from "react";

import { parseCompactSlashCommand } from "@src/engines/ChatPanel/hooks/useManualCompact";
import type useWorkspaceChat from "@src/engines/ChatPanel/hooks/useWorkspaceChat";
import type { useSessionDraftField } from "@src/hooks/session/useSessionPatch";
import { isCliSession } from "@src/util/session/sessionDispatch";

import { canvasSlashCommandNeedsInstruction } from "./canvasSlashCommand";
import type { InputAreaRefs, InputAreaState } from "./types";

interface UseInputAreaContentChangeOptions {
  refs: InputAreaRefs;
  state: InputAreaState;
  activeSessionId: string | undefined;
  draftSessionId: string;
  enableAgentInterceptors: boolean;
  handleSessInputChange: ReturnType<
    typeof useWorkspaceChat
  >["handleSessInputChange"];
  handlePromptPolishContentChange: () => void;
  setDraft: ReturnType<typeof useSessionDraftField>["setDraft"];
  programmaticInputMutationDepthRef: MutableRefObject<number>;
}

export function useInputAreaContentChange({
  refs,
  state,
  activeSessionId,
  draftSessionId,
  enableAgentInterceptors,
  handleSessInputChange,
  handlePromptPolishContentChange,
  setDraft,
  programmaticInputMutationDepthRef,
}: UseInputAreaContentChangeOptions) {
  const handleInputBlur = useCallback(() => {
    state.setIsInputFocused(false);
  }, [state]);

  const [compactHintVisible, setCompactHintVisible] = useState(false);
  const [canvasHintVisible, setCanvasHintVisible] = useState(false);

  const handleContentChange = useCallback(
    (text: string) => {
      const draftText =
        refs.composerInputRef.current?.getTextWithPills() ?? text;
      const cleanedText = draftText.trim();
      refs.setHasContent(cleanedText.length > 0);

      // Argument ghost hint for `/compact`: visible while the draft is a
      // compact command with no focus text yet (pill or typed form).
      {
        const compactDraft = parseCompactSlashCommand(cleanedText);
        setCompactHintVisible(
          compactDraft !== null && !compactDraft.instructions
        );
      }

      // Argument ghost hint for `/canvas` (same shape as compact). Gated the
      // way the submit projection is: composers that opt out of interceptors
      // and CLI sessions send the command through as ordinary text, so no
      // hint there.
      setCanvasHintVisible(
        enableAgentInterceptors &&
          !isCliSession(activeSessionId ?? null) &&
          canvasSlashCommandNeedsInstruction(cleanedText)
      );

      // Pass to workspace chat handler
      handleSessInputChange(draftText);

      if (programmaticInputMutationDepthRef.current > 0) {
        return;
      }

      handlePromptPolishContentChange();

      // Mirror the latest text onto the session row (debounced). Skip
      // when we don't have an active session id — the composer is only
      // mounted once we've resolved one in practice, but the ref form
      // guards against a flash of "" on first paint clobbering an
      // existing draft.
      if (draftSessionId) {
        setDraft(draftText);
      }
    },
    [
      activeSessionId,
      draftSessionId,
      enableAgentInterceptors,
      handlePromptPolishContentChange,
      handleSessInputChange,
      programmaticInputMutationDepthRef,
      refs,
      setDraft,
    ]
  );

  return {
    handleInputBlur,
    handleContentChange,
    compactHintVisible,
    canvasHintVisible,
  };
}

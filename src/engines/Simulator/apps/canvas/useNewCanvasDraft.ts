import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import {
  saveDraft,
  sessionCreatorDraftStoreAtom,
} from "@src/store/session/creatorDraftAtom";

/** Start a separate composer draft; never replace the replayed session's input. */
export function useNewCanvasDraft() {
  const setDraftStore = useSetAtom(sessionCreatorDraftStoreAtom);
  const { goToNewSession } = useAppNavigation();

  return useCallback(() => {
    const draft = saveDraft({
      sessionName: "",
      editorContent: "canvas [skill:/canvas] ",
      editorSnapshot: {
        parts: [
          {
            kind: "pill",
            attrs: {
              filePath: "/canvas",
              fileName: "canvas",
              isFolder: false,
              iconType: "skill",
              lineStart: null,
              lineEnd: null,
            },
          },
          { kind: "text", text: " " },
        ],
      },
      uploadedFiles: [],
    });
    // Keep the previous draft active until navigation promotes it. Selecting
    // the new draft here would instead promote the wrong draft into the sidebar.
    setDraftStore((previous) => ({
      ...previous,
      drafts: { ...previous.drafts, [draft.id]: draft },
    }));
    goToNewSession({ draftId: draft.id });
  }, [goToNewSession, setDraftStore]);
}

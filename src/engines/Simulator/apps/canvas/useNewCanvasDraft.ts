import { useSetAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import { openOrFocusChatPanelStartPageTabAtom } from "@src/store/chatPanel/chatPanelTabOpen/startPage";
import {
  saveDraft,
  sessionCreatorDraftStoreAtom,
} from "@src/store/session/creatorDraftAtom";
import { activeStationChatVisibleAtom } from "@src/store/ui/chatPanel/visibilityAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";

/** Start a separate composer draft; never replace the replayed session's input. */
export function useNewCanvasDraft() {
  const store = useStore();
  const { t } = useTranslation("navigation");
  const openStartPage = useSetAtom(openOrFocusChatPanelStartPageTabAtom);
  const showChat = useSetAtom(activeStationChatVisibleAtom);
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
    // The active chat tab owns the displayed session. Clearing the shared
    // pipeline alone leaves the previous session tab visible and its creator
    // unmounted. Use the same Launchpad activation as the sidebar entry.
    openStartPage({ title: t("routes.launchpad") });
    showChat(store.get(stationModeAtom), true);
  }, [goToNewSession, openStartPage, setDraftStore, showChat, store, t]);
}

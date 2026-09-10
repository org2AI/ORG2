import type { TFunction } from "i18next";
import { useSetAtom } from "jotai";
import { type ComponentProps, useCallback } from "react";

import { SessionExportModal } from "@src/scaffold/NavigationSidebar/connectors/SessionExportModal";
import type { ChatPanelTab } from "@src/store/chatPanel/chatPanelTabsModel";
import type { Session } from "@src/store/session/sessionAtom/types";
import { moveSessionTabAtom } from "@src/store/session/sessionTabPlacementAtom";

import { useSessionActionModals } from "./useSessionActionModals";

type ExportActiveSession = ComponentProps<
  typeof SessionExportModal
>["activeSession"];

interface UseChatPanelSessionModalsOptions {
  activeChatTab: ChatPanelTab | null;
  activeSession: ExportActiveSession;
  closeHeaderActionsMenu: () => void;
  /** Full session row for the share dialog (design §6.3 header mount). */
  currentSession: Session | null;
  currentSessionId: string | null;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}

export function useChatPanelSessionModals({
  activeChatTab,
  activeSession,
  closeHeaderActionsMenu,
  currentSession,
  currentSessionId,
  t,
}: UseChatPanelSessionModalsOptions) {
  const moveSessionTab = useSetAtom(moveSessionTabAtom);
  const sharedModals = useSessionActionModals({
    activeSession,
    closeHeaderActionsMenu,
    currentSession,
    currentSessionId,
    t,
  });

  const handleMoveToWorkstation = useCallback(() => {
    if (activeChatTab?.type !== "session" || !activeChatTab.sessionId) return;
    moveSessionTab({
      source: "chat-panel",
      sourceTabId: activeChatTab.id,
      sessionId: activeChatTab.sessionId,
      title: activeChatTab.title,
    });
    closeHeaderActionsMenu();
  }, [activeChatTab, closeHeaderActionsMenu, moveSessionTab]);

  return {
    ...sharedModals,
    handleMoveToWorkstation,
  };
}

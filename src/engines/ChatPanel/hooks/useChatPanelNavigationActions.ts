import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { clearSessionAtom } from "@src/engines/SessionCore/core/atoms";
import { openChatPanelCreateTargetAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  activeSessionIdAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import { CHAT_PANEL_CREATE_TARGET } from "@src/store/ui/chatPanel/selectionAtoms";
import { resetChatPanelSessionSurfaceAtom } from "@src/store/ui/chatPanel/surfaceAtoms";

export function useChatPanelNavigationActions() {
  const resetSessionSurface = useSetAtom(resetChatPanelSessionSurfaceAtom);
  const openCreateTarget = useSetAtom(openChatPanelCreateTargetAtom);
  const dispatchClearSession = useSetAtom(clearSessionAtom);
  const setWorkstationActiveSessionId = useSetAtom(
    workstationActiveSessionIdAtom
  );
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);

  const resetActiveSession = useCallback(() => {
    dispatchClearSession();
    setWorkstationActiveSessionId(null);
    setActiveSessionId(null);
  }, [dispatchClearSession, setActiveSessionId, setWorkstationActiveSessionId]);

  const showSessionSurface = useCallback(() => {
    resetSessionSurface();
  }, [resetSessionSurface]);

  const openWorkItemCreate = useCallback(() => {
    openCreateTarget({
      target: CHAT_PANEL_CREATE_TARGET.WORK_ITEM,
    });
  }, [openCreateTarget]);

  const openProjectCreate = useCallback(() => {
    openCreateTarget({
      target: CHAT_PANEL_CREATE_TARGET.PROJECT,
    });
  }, [openCreateTarget]);

  return {
    dispatchClearSession,
    openProjectCreate,
    openWorkItemCreate,
    resetActiveSession,
    setActiveSessionId,
    setWorkstationActiveSessionId,
    showSessionSurface,
  };
}

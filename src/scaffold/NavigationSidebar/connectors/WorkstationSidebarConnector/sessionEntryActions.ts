import { useCallback } from "react";

import type { GoToNewSessionOptions } from "@src/hooks/navigation/useAppNavigation";
import {
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelCreateTarget,
} from "@src/store/ui/chatPanel/selectionAtoms";

interface UseSessionEntryActionsParams {
  goToNewSession: (options?: GoToNewSessionOptions) => void;
  resetChatPanelSessionSurface: () => void;
  openNewChatTab: () => void;
  setChatPanelCreateTarget: (target: ChatPanelCreateTarget) => void;
}

interface UseSessionEntryActionsResult {
  handleGoToNewSession: (options?: GoToNewSessionOptions) => void;
}

export function openNewChatFromSidebar(
  {
    goToNewSession,
    resetChatPanelSessionSurface,
    openNewChatTab,
    setChatPanelCreateTarget,
  }: UseSessionEntryActionsParams,
  options?: GoToNewSessionOptions
): void {
  resetChatPanelSessionSurface();
  setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
  goToNewSession(options);
  openNewChatTab();
}

export function useSessionEntryActions({
  goToNewSession,
  resetChatPanelSessionSurface,
  openNewChatTab,
  setChatPanelCreateTarget,
}: UseSessionEntryActionsParams): UseSessionEntryActionsResult {
  const handleGoToNewSession = useCallback(
    (options?: GoToNewSessionOptions) => {
      openNewChatFromSidebar(
        {
          goToNewSession,
          resetChatPanelSessionSurface,
          openNewChatTab,
          setChatPanelCreateTarget,
        },
        options
      );
    },
    [
      goToNewSession,
      resetChatPanelSessionSurface,
      openNewChatTab,
      setChatPanelCreateTarget,
    ]
  );

  return { handleGoToNewSession };
}

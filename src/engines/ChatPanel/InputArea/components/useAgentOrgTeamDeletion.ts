import { useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { type AgentOrgRunView, deleteAgentOrgTeam } from "@src/api/tauri/agent";
import Message from "@src/components/Message";
import { disposeAgentOrgGroupProjection } from "@src/engines/ChatPanel/hooks/agentOrgGroupProjectionStore";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { removeForkRelayEntry } from "@src/features/TeamCollaboration/forkSession";
import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import { applyRustSessionDeleteReceipt } from "@src/scaffold/NavigationSidebar/connectors/rustSessionDeleteReceipt";
import { closeSessionChatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import { removeSession } from "@src/store/session";
import {
  clearPendingFileOpensForSession,
  disposeWorkstationWorkspaceAtom,
} from "@src/store/workstation/tabs";
import { clearPendingCodeEditorTabForSession } from "@src/store/workstation/tabs/pendingCodeEditorTab";

import { logger } from "./agentOrgOverviewPanelShared";

interface UseAgentOrgTeamDeletionOptions {
  currentSessionId: string;
  currentRunId: string | null;
  runStatus: AgentOrgRunView["runStatus"] | undefined;
  rootSessionId: string | null | undefined;
}

export function useAgentOrgTeamDeletion({
  currentSessionId,
  currentRunId,
  runStatus,
  rootSessionId,
}: UseAgentOrgTeamDeletionOptions) {
  const { t } = useTranslation("sessions");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isArchived = runStatus === "archived";

  useEffect(() => {
    setDeleteModalOpen(false);
    setDeleteConfirmed(false);
  }, [currentRunId, currentSessionId, runStatus]);

  const { goToNewSession } = useAppNavigation();
  const disposeWorkstationWorkspace = useSetAtom(
    disposeWorkstationWorkspaceAtom
  );
  const closeSessionChatPanelTabs = useSetAtom(closeSessionChatPanelTabsAtom);

  const closeDeleteModal = useCallback(() => {
    if (isDeleting) return;
    setDeleteModalOpen(false);
    setDeleteConfirmed(false);
  }, [isDeleting]);

  const handleDeleteTeam = useCallback(async () => {
    if (!currentSessionId || !isArchived || !deleteConfirmed || isDeleting)
      return;
    setIsDeleting(true);
    try {
      const receipt = await deleteAgentOrgTeam(currentSessionId);
      if (currentRunId) disposeAgentOrgGroupProjection(currentRunId);
      const cleanup = {
        removeSession,
        removeForkRelayEntry,
        disposeWorkstationWorkspace,
        clearPendingFileOpens: clearPendingFileOpensForSession,
        clearPendingCodeEditorTab: clearPendingCodeEditorTabForSession,
        evictEventStore: (deletedSessionId: string) =>
          eventStoreProxy.evictSession(deletedSessionId),
      };
      const requiresNavigationReset = await applyRustSessionDeleteReceipt({
        requestedSessionId: currentSessionId,
        activeSessionId: currentSessionId,
        isAgentOrgRoot: rootSessionId === currentSessionId,
        receipt,
        cleanup: {
          ...cleanup,
          closeSessionTabs: closeSessionChatPanelTabs,
        },
      });
      cleanup.removeSession(currentSessionId);
      cleanup.removeForkRelayEntry(currentSessionId);
      cleanup.disposeWorkstationWorkspace(currentSessionId);
      cleanup.clearPendingFileOpens(currentSessionId);
      cleanup.clearPendingCodeEditorTab(currentSessionId);
      setDeleteModalOpen(false);
      // Closing the active Team tab already activates one safe neighbour (or
      // Launchpad). Only reset navigation when the deleted session had no
      // Chat Panel tab to own that transition, such as a WorkStation-only
      // presentation.
      if (requiresNavigationReset) goToNewSession();
    } catch (deleteError) {
      logger.error("Failed to delete Archived Agent Team:", deleteError);
      Message.error(t("planner.agentOrgOverview.deleteFailed"));
    } finally {
      setIsDeleting(false);
    }
  }, [
    currentSessionId,
    currentRunId,
    closeSessionChatPanelTabs,
    deleteConfirmed,
    disposeWorkstationWorkspace,
    goToNewSession,
    isArchived,
    isDeleting,
    t,
    rootSessionId,
  ]);

  return {
    deleteModalOpen,
    setDeleteModalOpen,
    deleteConfirmed,
    setDeleteConfirmed,
    isDeleting,
    closeDeleteModal,
    handleDeleteTeam,
  };
}

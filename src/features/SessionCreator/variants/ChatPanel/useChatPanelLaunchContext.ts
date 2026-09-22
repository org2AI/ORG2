/**
 * SessionCreatorChatPanel — launch-context hook.
 *
 * Owns the work-item context attached to the next launch, derives the
 * project / org / work-item launch context from the chat-panel selection
 * atoms, and wraps the caller's `onSessionStart` so the attached context is
 * cleared (and TUI mode applied) once a session actually starts.
 */
import { useAtomValue, useStore } from "jotai";
import { useCallback, useMemo, useState } from "react";

import type {
  SessionLaunchSuccessInfo,
  SessionLaunchWorkItemContext,
} from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/types";
import {
  org2CloudOrgsAtom,
  sidebarActiveCloudOrgIdAtom,
} from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { tuiModeAtom } from "@src/store/session/tuiModeAtom";
import {
  chatPanelSelectedProjectAtom,
  chatPanelSelectedProjectOrgAtom,
  chatPanelSelectedWorkItemAtom,
} from "@src/store/ui/chatPanel/selectionAtoms";

import { deriveChatPanelLaunchContext } from "./deriveLaunchContext";

interface UseChatPanelLaunchContextOptions {
  defaultTuiMode: boolean;
  isHumanMode: boolean;
  onSessionStart?: (info: SessionLaunchSuccessInfo) => void;
}

export function useChatPanelLaunchContext({
  defaultTuiMode,
  isHumanMode,
  onSessionStart,
}: UseChatPanelLaunchContextOptions) {
  const [attachedWorkItemContext, setAttachedWorkItemContext] =
    useState<SessionLaunchWorkItemContext | null>(null);
  const selectedProjectOrgContext = useAtomValue(
    chatPanelSelectedProjectOrgAtom
  );
  const selectedProjectContext = useAtomValue(chatPanelSelectedProjectAtom);
  const selectedWorkItemContext = useAtomValue(chatPanelSelectedWorkItemAtom);
  const activeCloudOrgId = useAtomValue(sidebarActiveCloudOrgIdAtom);
  const cloudOrgs = useAtomValue(org2CloudOrgsAtom);
  const activeCloudOrg = useMemo(
    () => cloudOrgs.find((org) => org.orgId === activeCloudOrgId) ?? null,
    [activeCloudOrgId, cloudOrgs]
  );
  const chatPanelLaunchContext = useMemo(
    () =>
      deriveChatPanelLaunchContext({
        activeCloudOrg,
        selectedProjectContext,
        selectedProjectOrgContext,
        selectedWorkItemContext,
      }),
    [
      activeCloudOrg,
      selectedProjectContext,
      selectedProjectOrgContext,
      selectedWorkItemContext,
    ]
  );
  const store = useStore();

  const handleSessionStart = useCallback(
    (info: SessionLaunchSuccessInfo) => {
      setAttachedWorkItemContext(null);
      if (defaultTuiMode && !isHumanMode) {
        store.set(tuiModeAtom(info.sessionId), true);
      }
      onSessionStart?.(info);
    },
    [
      onSessionStart,
      defaultTuiMode,
      isHumanMode,
      setAttachedWorkItemContext,
      store,
    ]
  );

  return {
    attachedWorkItemContext,
    setAttachedWorkItemContext,
    chatPanelLaunchContext,
    handleSessionStart,
  };
}

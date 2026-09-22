import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  archiveAgentOrgRun,
  pauseAgentOrgRun,
  resumeAgentOrgRun,
} from "@src/api/tauri/agent";
import Message from "@src/components/Message";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import {
  PAUSE_TOGGLE_GESTURE_COOLDOWN_MS,
  logger,
} from "./agentOrgOverviewPanelShared";

interface UseAgentOrgOverviewRunControlsOptions {
  currentSessionId: string;
  onRefresh: () => Promise<void>;
  canArchive: boolean;
  isRunning: boolean;
}

export function useAgentOrgOverviewRunControls({
  currentSessionId,
  onRefresh,
  canArchive,
  isRunning,
}: UseAgentOrgOverviewRunControlsOptions) {
  const { t } = useTranslation("sessions");
  const [isTogglingPause, setIsTogglingPause] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const pauseToggleLockedRef = useRef(false);
  const pauseToggleCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pauseToggleCooldownRef.current !== null) {
        clearTimeout(pauseToggleCooldownRef.current);
        pauseToggleCooldownRef.current = null;
      }
    };
  }, []);

  const beginPauseToggle = useCallback(() => {
    if (pauseToggleLockedRef.current) return false;
    pauseToggleLockedRef.current = true;
    setIsTogglingPause(true);
    return true;
  }, []);

  const finishPauseToggle = useCallback(() => {
    if (!mountedRef.current) {
      pauseToggleLockedRef.current = false;
      return;
    }
    pauseToggleCooldownRef.current = setTimeout(() => {
      pauseToggleCooldownRef.current = null;
      pauseToggleLockedRef.current = false;
      setIsTogglingPause(false);
    }, PAUSE_TOGGLE_GESTURE_COOLDOWN_MS);
  }, []);

  const handlePauseRun = useCallback(async () => {
    if (!currentSessionId || !beginPauseToggle()) return;
    try {
      await pauseAgentOrgRun(currentSessionId);
      await onRefresh();
    } catch (err: unknown) {
      logger.error("Failed to pause Agent Team run:", err);
    } finally {
      finishPauseToggle();
    }
  }, [beginPauseToggle, currentSessionId, finishPauseToggle, onRefresh]);

  const handleResumeRun = useCallback(async () => {
    if (!currentSessionId || !beginPauseToggle()) return;
    try {
      await resumeAgentOrgRun(currentSessionId);
      await onRefresh();
    } catch (err: unknown) {
      logger.error("Failed to resume Agent Team run:", err);
    } finally {
      finishPauseToggle();
    }
  }, [beginPauseToggle, currentSessionId, finishPauseToggle, onRefresh]);

  const handleArchiveRun = useCallback(async () => {
    if (!currentSessionId || !canArchive || isArchiving) return;
    const confirmed = await confirmDestructiveAction({
      title: t("planner.agentOrgOverview.archiveTitle"),
      message: isRunning
        ? t("planner.agentOrgOverview.archiveWorkingWarning")
        : t("planner.agentOrgOverview.archiveWarning"),
      okLabel: t("planner.agentOrgOverview.archiveRun"),
      cancelLabel: t("common:actions.cancel"),
    });
    if (!confirmed) return;
    setIsArchiving(true);
    try {
      await archiveAgentOrgRun(currentSessionId);
      await onRefresh();
    } catch (archiveError) {
      logger.error("Failed to Archive Agent Team:", archiveError);
      Message.error(t("planner.agentOrgOverview.archiveFailed"));
    } finally {
      setIsArchiving(false);
    }
  }, [canArchive, currentSessionId, isArchiving, isRunning, onRefresh, t]);

  return {
    isTogglingPause,
    isArchiving,
    handlePauseRun,
    handleResumeRun,
    handleArchiveRun,
  };
}

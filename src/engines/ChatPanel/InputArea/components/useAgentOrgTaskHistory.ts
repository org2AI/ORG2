import { useCallback, useEffect, useRef, useState } from "react";

import {
  AGENT_ORG_TASK_STATUS,
  type AgentOrgRunView,
  type AgentOrgTaskPage,
  type AgentOrgTaskStatus,
  getAgentOrgTaskPage,
} from "@src/api/tauri/agent";

import {
  logger,
  reportUnexpectedHistoryLoadError,
} from "./agentOrgOverviewPanelShared";

interface UseAgentOrgTaskHistoryOptions {
  currentSessionId: string;
  currentRunId: string | null;
  runStatus: AgentOrgRunView["runStatus"] | undefined;
}

export function useAgentOrgTaskHistory({
  currentSessionId,
  currentRunId,
  runStatus,
}: UseAgentOrgTaskHistoryOptions) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<AgentOrgTaskStatus>(
    AGENT_ORG_TASK_STATUS.COMPLETED
  );
  const [historyPage, setHistoryPage] = useState<AgentOrgTaskPage | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const historyRequestIdRef = useRef(0);
  const currentSessionIdRef = useRef(currentSessionId);
  const currentRunIdRef = useRef(currentRunId);
  currentSessionIdRef.current = currentSessionId;
  currentRunIdRef.current = currentRunId;
  const isArchived = runStatus === "archived";

  useEffect(() => {
    const archived = runStatus === "archived";
    historyRequestIdRef.current += 1;
    setHistoryExpanded(archived);
    setHistoryStatus(
      archived
        ? AGENT_ORG_TASK_STATUS.CANCELLED
        : AGENT_ORG_TASK_STATUS.COMPLETED
    );
    setHistoryPage(null);
    setHistoryLoading(false);
    setHistoryError(false);
  }, [currentRunId, currentSessionId, runStatus]);

  const loadHistoryPage = useCallback(
    async (
      status: AgentOrgTaskStatus,
      cursor?: string | null,
      direction: "forward" | "backward" = "forward"
    ) => {
      const sessionId = currentSessionId;
      const runId = currentRunId;
      const requestId = ++historyRequestIdRef.current;
      setHistoryLoading(true);
      setHistoryError(false);
      setHistoryPage(null);
      try {
        const page = await getAgentOrgTaskPage({
          sessionId,
          bucket: "history",
          status,
          cursor,
          direction,
        });
        if (
          historyRequestIdRef.current === requestId &&
          currentSessionIdRef.current === sessionId &&
          currentRunIdRef.current === runId
        ) {
          setHistoryPage(page);
        }
      } catch (historyLoadError) {
        logger.error(
          "Failed to load Agent Team Task history:",
          historyLoadError
        );
        if (
          historyRequestIdRef.current === requestId &&
          currentSessionIdRef.current === sessionId &&
          currentRunIdRef.current === runId
        ) {
          setHistoryError(true);
        }
      } finally {
        if (
          historyRequestIdRef.current === requestId &&
          currentSessionIdRef.current === sessionId &&
          currentRunIdRef.current === runId
        ) {
          setHistoryLoading(false);
        }
      }
    },
    [currentRunId, currentSessionId]
  );

  const handleHistoryToggle = useCallback(() => {
    const next = !historyExpanded;
    setHistoryExpanded(next);
    if (next && historyPage === null && !historyLoading) {
      loadHistoryPage(historyStatus).catch(reportUnexpectedHistoryLoadError);
    }
  }, [
    historyExpanded,
    historyLoading,
    historyPage,
    historyStatus,
    loadHistoryPage,
  ]);

  const handleHistoryStatus = useCallback(
    (status: AgentOrgTaskStatus) => {
      setHistoryStatus(status);
      loadHistoryPage(status).catch(reportUnexpectedHistoryLoadError);
    },
    [loadHistoryPage]
  );

  useEffect(() => {
    if (
      isArchived &&
      historyExpanded &&
      historyPage === null &&
      !historyLoading &&
      !historyError
    ) {
      loadHistoryPage(AGENT_ORG_TASK_STATUS.CANCELLED).catch(
        reportUnexpectedHistoryLoadError
      );
    }
  }, [
    historyExpanded,
    historyError,
    historyLoading,
    historyPage,
    isArchived,
    loadHistoryPage,
  ]);

  return {
    historyExpanded,
    historyStatus,
    historyPage,
    historyLoading,
    historyError,
    loadHistoryPage,
    handleHistoryToggle,
    handleHistoryStatus,
  };
}

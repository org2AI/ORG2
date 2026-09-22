import { useCallback, useEffect, useRef, useState } from "react";

import {
  type AgentOrgTask,
  type AgentOrgTaskAnnotationPage,
  getAgentOrgTaskAnnotationPage,
  getAgentOrgTaskDetail,
} from "@src/api/tauri/agent";

import { retainVisibleRecords } from "./agentOrgTaskListHelpers";

interface UseAgentOrgTaskDetailsOptions {
  tasks: AgentOrgTask[];
  currentSessionId: string | undefined;
  currentRunId: string | undefined;
}

export function useAgentOrgTaskDetails({
  tasks,
  currentSessionId,
  currentRunId,
}: UseAgentOrgTaskDetailsOptions) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, AgentOrgTask>>({});
  const [annotationPages, setAnnotationPages] = useState<
    Record<string, AgentOrgTaskAnnotationPage>
  >({});
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);
  const [annotationLoadingTaskId, setAnnotationLoadingTaskId] = useState<
    string | null
  >(null);
  const [detailErrorTaskId, setDetailErrorTaskId] = useState<string | null>(
    null
  );
  const detailRequestIdRef = useRef(0);
  const currentSessionIdRef = useRef(currentSessionId);
  const currentRunIdRef = useRef(currentRunId);
  const visibleTaskIdsRef = useRef(new Set(tasks.map((task) => task.id)));
  currentSessionIdRef.current = currentSessionId;
  currentRunIdRef.current = currentRunId;
  visibleTaskIdsRef.current = new Set(tasks.map((task) => task.id));

  useEffect(() => {
    detailRequestIdRef.current += 1;
    setExpandedTaskId(null);
    setDetails({});
    setAnnotationPages({});
    setLoadingTaskId(null);
    setAnnotationLoadingTaskId(null);
    setDetailErrorTaskId(null);
  }, [currentRunId, currentSessionId]);

  useEffect(() => {
    const visibleTaskIds = new Set(tasks.map((task) => task.id));
    setDetails((previous) => retainVisibleRecords(previous, visibleTaskIds));
    setAnnotationPages((previous) =>
      retainVisibleRecords(previous, visibleTaskIds)
    );
    if (expandedTaskId && !visibleTaskIds.has(expandedTaskId)) {
      detailRequestIdRef.current += 1;
      setExpandedTaskId(null);
      setLoadingTaskId(null);
      setAnnotationLoadingTaskId(null);
      setDetailErrorTaskId(null);
    }
  }, [expandedTaskId, tasks]);

  const toggleDetail = useCallback(
    async (task: AgentOrgTask) => {
      if (expandedTaskId === task.id) {
        detailRequestIdRef.current += 1;
        setExpandedTaskId(null);
        setLoadingTaskId(null);
        setAnnotationLoadingTaskId(null);
        return;
      }
      setExpandedTaskId(task.id);
      if (!currentSessionId || details[task.id]) return;
      const sessionId = currentSessionId;
      const runId = currentRunId;
      const requestId = ++detailRequestIdRef.current;
      setLoadingTaskId(task.id);
      setDetailErrorTaskId(null);
      try {
        const [detail, annotationPage] = await Promise.all([
          getAgentOrgTaskDetail({
            sessionId,
            taskId: task.id,
          }),
          getAgentOrgTaskAnnotationPage({
            sessionId,
            taskId: task.id,
          }),
        ]);
        if (
          detailRequestIdRef.current !== requestId ||
          currentSessionIdRef.current !== sessionId ||
          currentRunIdRef.current !== runId ||
          !visibleTaskIdsRef.current.has(task.id)
        ) {
          return;
        }
        setDetails((previous) => ({ ...previous, [task.id]: detail }));
        setAnnotationPages((previous) => ({
          ...previous,
          [task.id]: annotationPage,
        }));
      } catch {
        if (
          detailRequestIdRef.current === requestId &&
          currentSessionIdRef.current === sessionId &&
          currentRunIdRef.current === runId &&
          visibleTaskIdsRef.current.has(task.id)
        ) {
          setDetailErrorTaskId(task.id);
        }
      } finally {
        if (
          detailRequestIdRef.current === requestId &&
          currentSessionIdRef.current === sessionId &&
          currentRunIdRef.current === runId &&
          visibleTaskIdsRef.current.has(task.id)
        ) {
          setLoadingTaskId(null);
        }
      }
    },
    [currentRunId, currentSessionId, details, expandedTaskId]
  );

  const loadMoreAnnotations = useCallback(
    async (taskId: string) => {
      const annotationPage = annotationPages[taskId];
      if (
        !currentSessionId ||
        !annotationPage?.hasMore ||
        !annotationPage.nextCursor
      ) {
        return;
      }
      const sessionId = currentSessionId;
      const runId = currentRunId;
      const requestId = ++detailRequestIdRef.current;
      setAnnotationLoadingTaskId(taskId);
      try {
        const nextPage = await getAgentOrgTaskAnnotationPage({
          sessionId,
          taskId,
          cursor: annotationPage.nextCursor,
        });
        if (
          detailRequestIdRef.current !== requestId ||
          currentSessionIdRef.current !== sessionId ||
          currentRunIdRef.current !== runId ||
          !visibleTaskIdsRef.current.has(taskId)
        ) {
          return;
        }
        setAnnotationPages((previous) => {
          const currentPage = previous[taskId];
          if (!currentPage) return previous;
          const seen = new Set(
            currentPage.annotations.map((annotation) => annotation.id)
          );
          return {
            ...previous,
            [taskId]: {
              ...nextPage,
              annotations: [
                ...currentPage.annotations,
                ...nextPage.annotations.filter(
                  (annotation) => !seen.has(annotation.id)
                ),
              ],
            },
          };
        });
      } catch {
        if (
          detailRequestIdRef.current === requestId &&
          currentSessionIdRef.current === sessionId &&
          currentRunIdRef.current === runId &&
          visibleTaskIdsRef.current.has(taskId)
        ) {
          setDetailErrorTaskId(taskId);
        }
      } finally {
        if (
          detailRequestIdRef.current === requestId &&
          currentSessionIdRef.current === sessionId &&
          currentRunIdRef.current === runId &&
          visibleTaskIdsRef.current.has(taskId)
        ) {
          setAnnotationLoadingTaskId(null);
        }
      }
    },
    [annotationPages, currentRunId, currentSessionId]
  );

  return {
    expandedTaskId,
    details,
    annotationPages,
    loadingTaskId,
    annotationLoadingTaskId,
    detailErrorTaskId,
    toggleDetail,
    loadMoreAnnotations,
  };
}

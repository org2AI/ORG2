/**
 * Issue selection and mutations for the workstation Issues panel: timeline
 * load on select, and create / update / close / reopen / comment writes
 * projected into the shared list and selection atoms.
 */
import type React from "react";
import type { SetStateAction } from "react";
import { useCallback } from "react";

import { createLogger } from "@src/hooks/logger";
import {
  addIssueComment,
  closeIssue,
  createIssue,
  fetchIssueTimeline,
  issueCommentToTimelineItem,
  reopenIssue,
  updateIssue,
} from "@src/services/git/operations/githubIssues";
import type { GitHubIssue } from "@src/services/git/operations/githubIssues";
import type {
  WorkstationIssueListState,
  WorkstationSelectedIssueState,
} from "@src/store/workstation/codeEditor/workstationIssueAtom";

const logger = createLogger("WorkstationIssues");

export interface UpdateIssueFields {
  title?: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export function useWorkstationIssueMutations({
  mountedRef,
  resolvedRemoteUrl,
  setListState,
  setSelectedState,
}: {
  mountedRef: React.RefObject<boolean>;
  resolvedRemoteUrl: string | null;
  setListState: (update: SetStateAction<WorkstationIssueListState>) => void;
  setSelectedState: (
    update: SetStateAction<WorkstationSelectedIssueState>
  ) => void;
}) {
  // ── Issue selection ───────────────────────────────────────────────────────

  const selectIssue = useCallback(
    (issue: GitHubIssue | null) => {
      if (!issue) {
        setSelectedState((prev) => ({ ...prev, issue: null, timeline: [] }));
        return;
      }
      setSelectedState((prev) => ({
        ...prev,
        issue,
        timeline: [],
        timelineLoading: true,
      }));

      if (!resolvedRemoteUrl) {
        setSelectedState((prev) =>
          prev.issue?.number === issue.number
            ? { ...prev, timelineLoading: false }
            : prev
        );
        return;
      }
      (async () => {
        const result = await fetchIssueTimeline({
          remoteUrl: resolvedRemoteUrl,
          issueNumber: issue.number,
        });
        if (!mountedRef.current) return;
        if (result.data) {
          setSelectedState((prev) =>
            prev.issue?.number === issue.number
              ? {
                  ...prev,
                  timeline: result.data!,
                  timelineLoading: false,
                }
              : prev
          );
        } else {
          setSelectedState((prev) =>
            prev.issue?.number === issue.number
              ? { ...prev, timelineLoading: false }
              : prev
          );
        }
      })().catch((error: unknown) => {
        logger.warn("issue timeline fetch failed", error);
      });
    },
    [resolvedRemoteUrl, setSelectedState, mountedRef]
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const handleCreateIssue = useCallback(
    async (
      title: string,
      body?: string,
      labels?: string[],
      assignees?: string[]
    ): Promise<GitHubIssue | null> => {
      if (!resolvedRemoteUrl) return null;
      const result = await createIssue({
        remoteUrl: resolvedRemoteUrl,
        title,
        body,
        labels,
        assignees,
      });
      if (result.data && mountedRef.current) {
        setListState((prev) => ({
          ...prev,
          issues: [result.data!, ...prev.issues],
        }));
        return result.data;
      }
      return null;
    },
    [resolvedRemoteUrl, setListState, mountedRef]
  );

  const handleUpdateIssue = useCallback(
    async (number: number, fields: UpdateIssueFields): Promise<void> => {
      if (!resolvedRemoteUrl) return;
      const result = await updateIssue({
        remoteUrl: resolvedRemoteUrl,
        issueNumber: number,
        updates: fields,
      });
      if (result.data && mountedRef.current) {
        const updated = result.data;
        setListState((prev) => ({
          ...prev,
          issues: prev.issues.map((i) => (i.number === number ? updated : i)),
        }));
        setSelectedState((prev) =>
          prev.issue?.number === number ? { ...prev, issue: updated } : prev
        );
      }
    },
    [resolvedRemoteUrl, setListState, setSelectedState, mountedRef]
  );

  const handleCloseIssue = useCallback(
    async (number: number): Promise<void> => {
      if (!resolvedRemoteUrl) return;
      const result = await closeIssue({
        remoteUrl: resolvedRemoteUrl,
        issueNumber: number,
      });
      if (result.data && mountedRef.current) {
        const updated = result.data;
        setListState((prev) => ({
          ...prev,
          issues: prev.issues.map((i) => (i.number === number ? updated : i)),
        }));
        setSelectedState((prev) =>
          prev.issue?.number === number ? { ...prev, issue: updated } : prev
        );
      }
    },
    [resolvedRemoteUrl, setListState, setSelectedState, mountedRef]
  );

  const handleReopenIssue = useCallback(
    async (number: number): Promise<void> => {
      if (!resolvedRemoteUrl) return;
      const result = await reopenIssue({
        remoteUrl: resolvedRemoteUrl,
        issueNumber: number,
      });
      if (result.data && mountedRef.current) {
        const updated = result.data;
        setListState((prev) => ({
          ...prev,
          issues: prev.issues.map((i) => (i.number === number ? updated : i)),
        }));
        setSelectedState((prev) =>
          prev.issue?.number === number ? { ...prev, issue: updated } : prev
        );
      }
    },
    [resolvedRemoteUrl, setListState, setSelectedState, mountedRef]
  );

  const handleAddComment = useCallback(
    async (number: number, body: string): Promise<void> => {
      if (!resolvedRemoteUrl) return;
      setSelectedState((prev) => ({ ...prev, submittingComment: true }));
      const result = await addIssueComment({
        remoteUrl: resolvedRemoteUrl,
        issueNumber: number,
        body,
      });
      if (!mountedRef.current) return;
      if (result.data) {
        setSelectedState((prev) => ({
          ...prev,
          timeline: [
            ...prev.timeline,
            issueCommentToTimelineItem(result.data!),
          ],
          submittingComment: false,
        }));
        setListState((prev) => ({
          ...prev,
          issues: prev.issues.map((i) =>
            i.number === number ? { ...i, comments: i.comments + 1 } : i
          ),
        }));
      } else {
        setSelectedState((prev) => ({ ...prev, submittingComment: false }));
      }
    },
    [resolvedRemoteUrl, setSelectedState, setListState, mountedRef]
  );

  return {
    handleAddComment,
    handleCloseIssue,
    handleCreateIssue,
    handleReopenIssue,
    handleUpdateIssue,
    selectIssue,
  };
}

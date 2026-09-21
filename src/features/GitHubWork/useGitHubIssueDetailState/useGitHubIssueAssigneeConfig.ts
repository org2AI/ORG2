import type { Store } from "jotai/vanilla/store";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
} from "react";

import {
  listRepoAssigneesLocal,
  updateIssueLocal,
} from "@src/api/tauri/github";
import type { GitHubIssueUser } from "@src/api/tauri/github";
import {
  issueHasAssigneeLogins,
  resolveGitHubAssigneeUsers,
} from "@src/features/GitHubWork/githubIssueAssignees";
import {
  invalidateGitHubIssueDetailBundle,
  loadGitHubAssignableUsers,
} from "@src/features/GitHubWork/githubIssueDetailCoordinator";
import type { WorkItemExternalAssigneeConfig } from "@src/modules/ProjectManager/WorkItems/components/WorkItemProperties/types";
import type {
  WorkstationIssueCallbacks,
  WorkstationSelectedIssueState,
} from "@src/store/workstation/codeEditor/workstationIssueAtom";

import type { GitHubIssueInteractionResolution } from "./resolution";

/** Assignable-user loading and assignee mutation for the selected issue. */
export function useGitHubIssueAssigneeConfig({
  store,
  requestKey,
  repoFullName,
  authScope,
  currentResolution,
  setResolution,
  selectedState,
  setSelectedState,
  callbacks,
  requestGenerationRef,
}: {
  store: Store;
  requestKey: string | null;
  repoFullName: string | null;
  authScope: string | null;
  currentResolution: GitHubIssueInteractionResolution | null;
  setResolution: Dispatch<
    SetStateAction<GitHubIssueInteractionResolution | null>
  >;
  selectedState: WorkstationSelectedIssueState;
  setSelectedState: (
    update: SetStateAction<WorkstationSelectedIssueState>
  ) => void;
  callbacks: WorkstationIssueCallbacks;
  requestGenerationRef: { current: number };
}): WorkItemExternalAssigneeConfig | undefined {
  const assigneeMutationRef = useRef<{
    key: string;
    generation: number;
  } | null>(null);

  const loadAssignableUsers = useCallback((): Promise<void> => {
    if (
      !requestKey ||
      !repoFullName ||
      !authScope ||
      !currentResolution ||
      currentResolution.permissions?.can_manage_issues !== true
    ) {
      return Promise.resolve();
    }
    if (currentResolution.assignableUsersLoaded) {
      return Promise.resolve();
    }
    const generation = requestGenerationRef.current;

    setResolution((current) =>
      current?.key === requestKey
        ? {
            ...current,
            loadingAssignableUsers: true,
            assigneesError: null,
          }
        : current
    );

    return loadGitHubAssignableUsers(store, authScope, repoFullName, () =>
      listRepoAssigneesLocal(repoFullName)
    )
      .then((users) => {
        setResolution((current) =>
          current?.key === requestKey &&
          requestGenerationRef.current === generation
            ? {
                ...current,
                assignableUsers: users,
                assignableUsersLoaded: true,
                loadingAssignableUsers: false,
                assigneesError: null,
              }
            : current
        );
      })
      .catch((error: unknown) => {
        setResolution((current) =>
          current?.key === requestKey &&
          requestGenerationRef.current === generation
            ? {
                ...current,
                loadingAssignableUsers: false,
                assigneesError:
                  error instanceof Error ? error.message : String(error),
              }
            : current
        );
      });
  }, [
    authScope,
    currentResolution,
    repoFullName,
    requestGenerationRef,
    requestKey,
    setResolution,
    store,
  ]);

  const changeAssignees = useCallback(
    async (assigneeLogins: string[]): Promise<void> => {
      const issue = selectedState.issue;
      if (
        !requestKey ||
        !repoFullName ||
        !issue ||
        !currentResolution ||
        currentResolution.permissions?.can_manage_issues !== true ||
        currentResolution.updatingAssignees
      ) {
        return;
      }

      const generation = requestGenerationRef.current;
      if (
        assigneeMutationRef.current?.key === requestKey &&
        assigneeMutationRef.current.generation === generation
      ) {
        return;
      }
      assigneeMutationRef.current = { key: requestKey, generation };

      const previousAssignees = issue.assignees;
      const optimisticAssignees = resolveGitHubAssigneeUsers(
        previousAssignees,
        currentResolution.assignableUsers,
        assigneeLogins
      );
      setResolution((current) =>
        current?.key === requestKey
          ? { ...current, updatingAssignees: true, assigneesError: null }
          : current
      );
      setSelectedState((current) =>
        requestGenerationRef.current === generation &&
        current.issue?.id === issue.id
          ? {
              ...current,
              issue: { ...current.issue, assignees: optimisticAssignees },
            }
          : current
      );

      try {
        const updatedIssue = await updateIssueLocal(
          repoFullName,
          issue.number,
          { assignees: assigneeLogins }
        );
        if (!issueHasAssigneeLogins(updatedIssue, assigneeLogins)) {
          throw new Error("GitHub did not apply the assignee update.");
        }
        invalidateGitHubIssueDetailBundle(store, requestKey);
        setSelectedState((current) =>
          requestGenerationRef.current === generation &&
          current.issue?.id === issue.id
            ? { ...current, issue: updatedIssue }
            : current
        );
        setResolution((current) =>
          current?.key === requestKey &&
          requestGenerationRef.current === generation
            ? {
                ...current,
                updatingAssignees: false,
                assigneesError: null,
              }
            : current
        );
        callbacks.refreshIssues?.();
      } catch (error) {
        setSelectedState((current) =>
          requestGenerationRef.current === generation &&
          current.issue?.id === issue.id
            ? {
                ...current,
                issue: { ...current.issue, assignees: previousAssignees },
              }
            : current
        );
        setResolution((current) =>
          current?.key === requestKey &&
          requestGenerationRef.current === generation
            ? {
                ...current,
                updatingAssignees: false,
                assigneesError:
                  error instanceof Error ? error.message : String(error),
              }
            : current
        );
      } finally {
        if (
          assigneeMutationRef.current?.key === requestKey &&
          assigneeMutationRef.current.generation === generation
        ) {
          assigneeMutationRef.current = null;
        }
      }
    },
    [
      callbacks,
      currentResolution,
      repoFullName,
      requestGenerationRef,
      requestKey,
      selectedState.issue,
      setResolution,
      setSelectedState,
      store,
    ]
  );

  return useMemo<WorkItemExternalAssigneeConfig | undefined>(() => {
    const issue = selectedState.issue;
    if (!issue || !requestKey || !currentResolution) return undefined;

    const usersByLogin = new Map<string, GitHubIssueUser>();
    for (const user of [
      ...issue.assignees,
      ...currentResolution.assignableUsers,
    ]) {
      usersByLogin.set(user.login.toLowerCase(), user);
    }
    const canManageAssignees =
      currentResolution.permissions?.can_manage_issues === true;

    return {
      currentAssigneeIds: issue.assignees.map((assignee) => assignee.login),
      options: Array.from(usersByLogin.values()).map((user) => ({
        id: user.login,
        label: user.login,
        avatar: user.avatar_url,
      })),
      loading: currentResolution.loadingAssignableUsers,
      error: currentResolution.assigneesError,
      disabled: !canManageAssignees || currentResolution.updatingAssignees,
      readonlyReason: canManageAssignees
        ? undefined
        : "Repository permission is required to manage issue assignees.",
      onOpen: loadAssignableUsers,
      onChangeAssigneeIds: changeAssignees,
    };
  }, [
    changeAssignees,
    currentResolution,
    loadAssignableUsers,
    requestKey,
    selectedState.issue,
  ]);
}

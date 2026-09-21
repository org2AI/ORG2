import type {
  GitHubIssue,
  GitHubIssueTimelineItem,
  GitHubIssueUser,
  GitHubRepoPermissions,
} from "@src/api/tauri/github";
import type { GitHubIssueInteractionConfig } from "@src/modules/ProjectManager/WorkItems/components/WorkItemContent/types";
import { parseGithubRepoFullName } from "@src/services/git/operations/createPullRequest";

/**
 * Reported when a request settled without an issue and the failing call left no
 * message of its own — an unresolvable repository, or auth-scope resolution
 * that failed before any request could be keyed.
 */
export const GITHUB_ISSUE_UNAVAILABLE_ERROR = "github_issue_unavailable";

/** Reported when the detail request outlived its deadline without settling. */
export const GITHUB_ISSUE_TIMEOUT_ERROR = "github_issue_request_timeout";

/**
 * Deadline for one issue-detail read. A transport that never settles is
 * indistinguishable from a slow one, so without a bound the surface waits on a
 * skeleton forever and can never explain itself. The underlying request is not
 * cancellable and keeps running — if it does finish, it still populates the
 * shared cache for the next attempt.
 */
export const ISSUE_DETAIL_REQUEST_TIMEOUT_MS = 30_000;

export function withDeadline<T>(
  request: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

export interface GitHubIssueInteractionResolution {
  key: string;
  viewer: GitHubIssueUser | null;
  permissions: GitHubRepoPermissions | null;
  duplicateCandidates: GitHubIssue[];
  duplicateCandidatesLoaded: boolean;
  loadingDuplicateCandidates: boolean;
  duplicateCandidatesError: boolean;
  assignableUsers: GitHubIssueUser[];
  assignableUsersLoaded: boolean;
  loadingAssignableUsers: boolean;
  assigneesError: string | null;
  submittingComment: boolean;
  updatingBody: boolean;
  updatingStatus: boolean;
  updatingAssignees: boolean;
  error: GitHubIssueInteractionConfig["error"];
}

function sameLogin(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function resolveViewer(
  login: string,
  issue: GitHubIssue | null,
  timeline: GitHubIssueTimelineItem[]
): GitHubIssueUser {
  const knownUsers = [
    issue?.user,
    ...(issue?.assignees ?? []),
    ...timeline.map((item) => item.actor),
  ].filter((user): user is GitHubIssueUser => Boolean(user));
  const knownViewer = knownUsers.find((user) => sameLogin(user.login, login));

  return (
    knownViewer ?? {
      login,
      avatar_url: `https://github.com/${encodeURIComponent(login)}.png?size=64`,
    }
  );
}

function isRepoFullName(value: string | null): value is string {
  return Boolean(value && /^[^/:@\s]+\/[^/\s]+$/.test(value));
}

export function resolveGitHubIssueRepoFullName(
  remoteUrl: string | undefined,
  issueUrl: string | undefined
): string | null {
  if (isRepoFullName(remoteUrl ?? null)) return remoteUrl ?? null;
  const remoteRepo = remoteUrl ? parseGithubRepoFullName(remoteUrl) : null;
  if (isRepoFullName(remoteRepo)) return remoteRepo;

  if (!issueUrl) return null;
  try {
    const url = new URL(issueUrl);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo, kind] = url.pathname.split("/").filter(Boolean);
    return owner && repo && kind === "issues" ? `${owner}/${repo}` : null;
  } catch {
    return null;
  }
}

export function canEditIssue(
  resolution: GitHubIssueInteractionResolution | null,
  issue: GitHubIssue | null
): boolean {
  return (
    resolution?.permissions?.can_manage_issues === true ||
    Boolean(
      issue &&
      resolution?.viewer &&
      sameLogin(issue.user.login, resolution.viewer.login)
    )
  );
}

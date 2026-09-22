import type { GitHubIssue, OpenPRItem } from "@src/api/tauri/github";
import { formatCompactAge } from "@src/util/time/formatRelativeTime";

import {
  matchesGitHubDateRange,
  matchesGitHubNumberRange,
} from "./githubWorkItemsQueryRanges";
import {
  GITHUB_QUERY_MISSING,
  GITHUB_QUERY_SCOPE,
  GITHUB_QUERY_STATE,
} from "./githubWorkItemsSearchQuery";
import type { ParsedGitHubSearchQuery } from "./githubWorkItemsSearchQuery";
import type { GitHubRepoSource } from "./githubWorkItemsTypes";
import { matchesOpsPrQueryState } from "./githubWorkItemsViewCache";

export const GITHUB_ITEM_KIND = {
  ISSUE: "issue",
  PR: "pr",
} as const;

export type ManagedIssueLabel = GitHubIssue["labels"][number];

export interface ManagedIssueItem {
  kind: typeof GITHUB_ITEM_KIND.ISSUE;
  id: number;
  title: string;
  repo: string;
  repoPath: string;
  remoteUrl: string;
  viewerLogin: string | null;
  authScope?: string | null;
  repoPermissions?: GitHubRepoSource["permissions"];
  rawIssue: GitHubIssue;
  author: string;
  timeAgo: string;
  state: GitHubIssue["state"];
  labels: ManagedIssueLabel[];
  comments: number;
  linkedPullRequests: number;
  updatedAt: string;
}

export interface ManagedPrItem {
  kind: typeof GITHUB_ITEM_KIND.PR;
  id: number;
  title: string;
  repo: string;
  repoId: string;
  repoPath: string;
  remoteUrl: string;
  viewerLogin: string | null;
  rawPr: OpenPRItem;
  author: string;
  authoredByViewer: boolean;
  reviewRequestedFromViewer: boolean;
  timeAgo: string;
  state: string;
  sourceBranch: string;
  targetBranch: string;
  updatedAt: string;
}

export type ManagedGitHubItem = ManagedIssueItem | ManagedPrItem;

export function getManagedGitHubItemKey(item: ManagedGitHubItem): string {
  return `${item.kind}-${item.repo}-${item.id}`;
}

export function getManagedPullRequestKey(pullRequest: ManagedPrItem): string {
  return `${pullRequest.repo}#${pullRequest.id}`;
}

function isSameGitHubLogin(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function formatGitHubItemTimeAgo(
  value: string,
  now: number = Date.now()
): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "";
  return formatCompactAge(timestamp, now);
}

export function mapIssueToManagedItem(
  issue: GitHubIssue,
  source: GitHubRepoSource
): ManagedIssueItem {
  return {
    kind: GITHUB_ITEM_KIND.ISSUE,
    id: issue.number,
    title: issue.title,
    repo: source.repoFullName,
    repoPath: source.repoPath,
    remoteUrl: source.remoteUrl,
    viewerLogin: source.viewerLogin,
    authScope: source.authScope,
    repoPermissions: source.permissions,
    rawIssue: issue,
    author: issue.user.login,
    timeAgo: formatGitHubItemTimeAgo(issue.updated_at),
    state: issue.state,
    labels: issue.labels,
    comments: issue.comments,
    linkedPullRequests: issue.linked_pull_requests_count ?? 0,
    updatedAt: issue.updated_at,
  };
}

export function mapPrToManagedItem(
  pr: OpenPRItem,
  source: GitHubRepoSource
): ManagedPrItem {
  const authoredByViewer = isSameGitHubLogin(
    pr.author_login,
    source.viewerLogin
  );
  const reviewRequestedFromViewer = pr.requested_reviewer_logins.some(
    (reviewerLogin) => isSameGitHubLogin(reviewerLogin, source.viewerLogin)
  );
  return {
    kind: GITHUB_ITEM_KIND.PR,
    id: pr.number,
    title: pr.title,
    repo: source.repoFullName,
    repoId: source.repoId,
    repoPath: source.repoPath,
    remoteUrl: source.remoteUrl,
    viewerLogin: source.viewerLogin,
    rawPr: pr,
    author: pr.author_login,
    authoredByViewer,
    reviewRequestedFromViewer,
    timeAgo: formatGitHubItemTimeAgo(pr.updated_at),
    state: pr.state,
    sourceBranch: pr.head_branch,
    targetBranch: pr.base_branch,
    updatedAt: pr.updated_at,
  };
}

export function managedItemMatchesRepo(
  item: ManagedGitHubItem,
  repoFullName: string
): boolean {
  return item.repo === repoFullName;
}

function getSearchableParts(item: ManagedGitHubItem): string[] {
  if (item.kind === GITHUB_ITEM_KIND.ISSUE) {
    return [
      item.title,
      item.repo,
      item.author,
      `#${item.id}`,
      ...item.labels.map((label) => label.name),
    ];
  }
  return [
    item.title,
    item.repo,
    item.author,
    item.sourceBranch,
    item.targetBranch,
    `#${item.id}`,
    `pr #${item.id}`,
  ];
}

function matchesAnyLogin(
  candidates: string[],
  expected: string[],
  viewerLogin: string | null
): boolean {
  return expected.some((login) => {
    const resolved = login === "@me" ? viewerLogin : login;
    return candidates.some((candidate) =>
      isSameGitHubLogin(candidate, resolved)
    );
  });
}

function matchesAnyName(candidate: string, expected: string[]): boolean {
  return expected.some(
    (name) => name.toLowerCase() === candidate.toLowerCase()
  );
}

function getItemAssigneeLogins(item: ManagedGitHubItem): string[] {
  return item.kind === GITHUB_ITEM_KIND.ISSUE
    ? item.rawIssue.assignees.map((assignee) => assignee.login)
    : [];
}

function getItemLabelNames(item: ManagedGitHubItem): Set<string> {
  return new Set(
    item.kind === GITHUB_ITEM_KIND.ISSUE
      ? item.labels.map((label) => label.name.toLowerCase())
      : []
  );
}

/** Qualifiers only an issue carries; a pull request never satisfies them. */
function issueMatchesQuery(
  item: ManagedGitHubItem,
  query: ParsedGitHubSearchQuery
): boolean {
  const usesIssueFields =
    query.assignees.length > 0 ||
    query.labels.length > 0 ||
    query.milestones.length > 0 ||
    query.missing.length > 0 ||
    query.linkedPullRequest !== null ||
    query.comments !== null;
  if (item.kind !== GITHUB_ITEM_KIND.ISSUE) return !usesIssueFields;

  const assignees = getItemAssigneeLogins(item);
  if (
    query.assignees.length > 0 &&
    !matchesAnyLogin(assignees, query.assignees, item.viewerLogin)
  )
    return false;
  const labels = getItemLabelNames(item);
  if (!query.labels.every((label) => labels.has(label.toLowerCase())))
    return false;
  const milestone = item.rawIssue.milestone;
  if (
    query.milestones.length > 0 &&
    (!milestone || !matchesAnyName(milestone, query.milestones))
  )
    return false;
  if (
    query.missing.includes(GITHUB_QUERY_MISSING.ASSIGNEE) &&
    assignees.length > 0
  )
    return false;
  if (query.missing.includes(GITHUB_QUERY_MISSING.LABEL) && labels.size > 0)
    return false;
  if (query.missing.includes(GITHUB_QUERY_MISSING.MILESTONE) && milestone)
    return false;
  if (
    query.linkedPullRequest !== null &&
    item.linkedPullRequests > 0 !== query.linkedPullRequest
  )
    return false;
  return (
    !query.comments || matchesGitHubNumberRange(item.comments, query.comments)
  );
}

/** Qualifiers only a pull request carries; an issue never satisfies them. */
function pullRequestMatchesQuery(
  item: ManagedGitHubItem,
  query: ParsedGitHubSearchQuery
): boolean {
  const usesPrFields =
    query.draft !== null ||
    query.reviewRequested.length > 0 ||
    query.baseBranches.length > 0 ||
    query.headBranches.length > 0 ||
    query.ciStatuses.length > 0;
  if (item.kind !== GITHUB_ITEM_KIND.PR) return !usesPrFields;

  if (query.draft !== null && item.rawPr.draft !== query.draft) return false;
  if (
    query.reviewRequested.length > 0 &&
    !matchesAnyLogin(
      item.rawPr.requested_reviewer_logins,
      query.reviewRequested,
      item.viewerLogin
    )
  )
    return false;
  if (
    query.baseBranches.length > 0 &&
    !matchesAnyName(item.targetBranch, query.baseBranches)
  )
    return false;
  if (
    query.headBranches.length > 0 &&
    !matchesAnyName(item.sourceBranch, query.headBranches)
  )
    return false;
  return (
    query.ciStatuses.length === 0 ||
    matchesAnyName(item.rawPr.ci_status, query.ciStatuses)
  );
}

export function managedItemMatchesQuery(
  item: ManagedGitHubItem,
  query: ParsedGitHubSearchQuery,
  now: number = Date.now()
): boolean {
  if (
    query.scope === GITHUB_QUERY_SCOPE.ISSUE &&
    item.kind !== GITHUB_ITEM_KIND.ISSUE
  )
    return false;
  if (
    query.scope === GITHUB_QUERY_SCOPE.PR &&
    item.kind !== GITHUB_ITEM_KIND.PR
  )
    return false;
  if (query.state && query.state !== GITHUB_QUERY_STATE.ALL) {
    if (item.kind === GITHUB_ITEM_KIND.PR) {
      if (!matchesOpsPrQueryState(item.state, query.state)) return false;
    } else if (item.state !== query.state) return false;
  }
  if (
    query.authors.length > 0 &&
    !matchesAnyLogin([item.author], query.authors, item.viewerLogin)
  )
    return false;
  if (matchesAnyLogin([item.author], query.excludedAuthors, item.viewerLogin))
    return false;
  if (
    matchesAnyLogin(
      getItemAssigneeLogins(item),
      query.excludedAssignees,
      item.viewerLogin
    )
  )
    return false;
  const labels = getItemLabelNames(item);
  if (query.excludedLabels.some((label) => labels.has(label.toLowerCase())))
    return false;
  if (!issueMatchesQuery(item, query)) return false;
  if (!pullRequestMatchesQuery(item, query)) return false;
  const createdAt =
    item.kind === GITHUB_ITEM_KIND.ISSUE
      ? item.rawIssue.created_at
      : item.rawPr.created_at;
  if (
    query.updated &&
    !matchesGitHubDateRange(item.updatedAt, query.updated, now)
  )
    return false;
  if (query.created && !matchesGitHubDateRange(createdAt, query.created, now))
    return false;
  const freeText = query.freeText.toLowerCase();
  return (
    !freeText ||
    getSearchableParts(item).some((part) =>
      part.toLowerCase().includes(freeText)
    )
  );
}

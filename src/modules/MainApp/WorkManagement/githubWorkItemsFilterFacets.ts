import {
  GITHUB_ITEM_KIND,
  type ManagedGitHubItem,
  managedItemMatchesRepo,
} from "./githubManagedItemModel";
import {
  GITHUB_QUERY_CI_STATUSES,
  GITHUB_QUERY_MISSING,
  type GitHubQueryCiStatus,
  type GitHubQueryRange,
  type GitHubQueryScope,
  type ParsedGitHubSearchQuery,
  createEmptyGitHubSearchQuery,
} from "./githubWorkItemsSearchQuery";

type WorkItemScope = Extract<GitHubQueryScope, "issue" | "pr">;

/** A query list the filter menu fills from values seen on loaded items. */
export const GITHUB_FACET = {
  AUTHOR: "authors",
  ASSIGNEE: "assignees",
  LABEL: "labels",
  MILESTONE: "milestones",
  REVIEW_REQUESTED: "reviewRequested",
  BASE_BRANCH: "baseBranches",
  CI_STATUS: "ciStatuses",
} as const;

export type GitHubFacetKey = (typeof GITHUB_FACET)[keyof typeof GITHUB_FACET];

export interface GitHubFacetOption {
  value: string;
  /** Loaded items carrying this value. */
  count: number;
}

export type GitHubWorkItemFacets = Record<GitHubFacetKey, GitHubFacetOption[]>;

export const EMPTY_GITHUB_WORK_ITEM_FACETS: GitHubWorkItemFacets = {
  authors: [],
  assignees: [],
  labels: [],
  milestones: [],
  reviewRequested: [],
  baseBranches: [],
  ciStatuses: [],
};

export const GITHUB_FACETS_BY_SCOPE: Record<WorkItemScope, GitHubFacetKey[]> = {
  issue: [
    GITHUB_FACET.AUTHOR,
    GITHUB_FACET.ASSIGNEE,
    GITHUB_FACET.LABEL,
    GITHUB_FACET.MILESTONE,
  ],
  pr: [
    GITHUB_FACET.AUTHOR,
    GITHUB_FACET.REVIEW_REQUESTED,
    GITHUB_FACET.BASE_BRANCH,
    GITHUB_FACET.CI_STATUS,
  ],
};

function getItemFacetValues(
  item: ManagedGitHubItem,
  facet: GitHubFacetKey
): string[] {
  if (facet === GITHUB_FACET.AUTHOR) return item.author ? [item.author] : [];
  if (item.kind === GITHUB_ITEM_KIND.ISSUE) {
    if (facet === GITHUB_FACET.ASSIGNEE)
      return item.rawIssue.assignees.map((assignee) => assignee.login);
    if (facet === GITHUB_FACET.LABEL)
      return item.labels.map((label) => label.name);
    if (facet === GITHUB_FACET.MILESTONE)
      return item.rawIssue.milestone ? [item.rawIssue.milestone] : [];
    return [];
  }
  if (facet === GITHUB_FACET.REVIEW_REQUESTED)
    return item.rawPr.requested_reviewer_logins;
  if (facet === GITHUB_FACET.BASE_BRANCH)
    return item.targetBranch ? [item.targetBranch] : [];
  if (facet === GITHUB_FACET.CI_STATUS) {
    const status = item.rawPr.ci_status;
    return GITHUB_QUERY_CI_STATUSES.some((known) => known === status)
      ? [status]
      : [];
  }
  return [];
}

/**
 * Collects the values the filter menu offers from the loaded items of one
 * repository and scope. State and the active query are ignored on purpose:
 * options must not disappear as soon as picking one narrows the list.
 */
export function buildGitHubWorkItemFacets(
  items: ManagedGitHubItem[],
  scope: WorkItemScope,
  repoFullName: string
): GitHubWorkItemFacets {
  const kind = scope === "issue" ? GITHUB_ITEM_KIND.ISSUE : GITHUB_ITEM_KIND.PR;
  const counts = new Map<GitHubFacetKey, Map<string, GitHubFacetOption>>();
  for (const item of items) {
    if (item.kind !== kind || !managedItemMatchesRepo(item, repoFullName))
      continue;
    for (const facet of GITHUB_FACETS_BY_SCOPE[scope]) {
      const facetCounts =
        counts.get(facet) ?? new Map<string, GitHubFacetOption>();
      counts.set(facet, facetCounts);
      for (const value of getItemFacetValues(item, facet)) {
        const key = value.toLowerCase();
        const current = facetCounts.get(key);
        if (current) current.count += 1;
        else facetCounts.set(key, { value, count: 1 });
      }
    }
  }
  const facets: GitHubWorkItemFacets = { ...EMPTY_GITHUB_WORK_ITEM_FACETS };
  for (const [facet, facetCounts] of counts) {
    facets[facet] = [...facetCounts.values()].sort(
      (left, right) =>
        right.count - left.count || left.value.localeCompare(right.value)
    );
  }
  return facets;
}

function includesValue(values: string[], value: string): boolean {
  return values.some(
    (current) => current.toLowerCase() === value.toLowerCase()
  );
}

export function isGitHubFacetValueSelected(
  query: ParsedGitHubSearchQuery,
  facet: GitHubFacetKey,
  value: string
): boolean {
  return includesValue(query[facet], value);
}

export function toggleGitHubFacetValue(
  query: ParsedGitHubSearchQuery,
  facet: GitHubFacetKey,
  value: string
): void {
  const current: string[] = query[facet];
  const next = includesValue(current, value)
    ? current.filter((entry) => entry.toLowerCase() !== value.toLowerCase())
    : [...current, value];
  if (facet === GITHUB_FACET.CI_STATUS) {
    query.ciStatuses = next.filter((entry): entry is GitHubQueryCiStatus =>
      GITHUB_QUERY_CI_STATUSES.some((known) => known === entry)
    );
    return;
  }
  query[facet] = next;
}

/** One-click filters listed above the value sections. */
export const GITHUB_QUICK_FILTER = {
  CREATED_BY_ME: "createdByMe",
  ASSIGNED_TO_ME: "assignedToMe",
  REVIEW_REQUESTED_FROM_ME: "reviewRequestedFromMe",
  NO_ASSIGNEE: "noAssignee",
  NO_LABEL: "noLabel",
  LINKED_PR: "linkedPullRequest",
  DRAFT: "draft",
  READY_FOR_REVIEW: "readyForReview",
  RECENTLY_UPDATED: "recentlyUpdated",
  STALE: "stale",
} as const;

export type GitHubQuickFilter =
  (typeof GITHUB_QUICK_FILTER)[keyof typeof GITHUB_QUICK_FILTER];

export const GITHUB_QUICK_FILTERS_BY_SCOPE: Record<
  WorkItemScope,
  GitHubQuickFilter[]
> = {
  issue: [
    GITHUB_QUICK_FILTER.CREATED_BY_ME,
    GITHUB_QUICK_FILTER.ASSIGNED_TO_ME,
    GITHUB_QUICK_FILTER.NO_ASSIGNEE,
    GITHUB_QUICK_FILTER.NO_LABEL,
    GITHUB_QUICK_FILTER.LINKED_PR,
    GITHUB_QUICK_FILTER.RECENTLY_UPDATED,
    GITHUB_QUICK_FILTER.STALE,
  ],
  pr: [
    GITHUB_QUICK_FILTER.CREATED_BY_ME,
    GITHUB_QUICK_FILTER.REVIEW_REQUESTED_FROM_ME,
    GITHUB_QUICK_FILTER.DRAFT,
    GITHUB_QUICK_FILTER.READY_FOR_REVIEW,
    GITHUB_QUICK_FILTER.RECENTLY_UPDATED,
    GITHUB_QUICK_FILTER.STALE,
  ],
};

const RECENTLY_UPDATED_RANGE: GitHubQueryRange = {
  kind: "compare",
  operator: ">",
  operand: "7d",
};
const STALE_RANGE: GitHubQueryRange = {
  kind: "compare",
  operator: "<",
  operand: "30d",
};

function isSameRange(
  left: GitHubQueryRange | null,
  right: GitHubQueryRange
): boolean {
  return (
    left?.kind === "compare" &&
    right.kind === "compare" &&
    left.operator === right.operator &&
    left.operand.toLowerCase() === right.operand
  );
}

export function isGitHubQuickFilterActive(
  query: ParsedGitHubSearchQuery,
  filter: GitHubQuickFilter
): boolean {
  switch (filter) {
    case GITHUB_QUICK_FILTER.CREATED_BY_ME:
      return includesValue(query.authors, "@me");
    case GITHUB_QUICK_FILTER.ASSIGNED_TO_ME:
      return includesValue(query.assignees, "@me");
    case GITHUB_QUICK_FILTER.REVIEW_REQUESTED_FROM_ME:
      return includesValue(query.reviewRequested, "@me");
    case GITHUB_QUICK_FILTER.NO_ASSIGNEE:
      return query.missing.includes(GITHUB_QUERY_MISSING.ASSIGNEE);
    case GITHUB_QUICK_FILTER.NO_LABEL:
      return query.missing.includes(GITHUB_QUERY_MISSING.LABEL);
    case GITHUB_QUICK_FILTER.LINKED_PR:
      return query.linkedPullRequest === true;
    case GITHUB_QUICK_FILTER.DRAFT:
      return query.draft === true;
    case GITHUB_QUICK_FILTER.READY_FOR_REVIEW:
      return query.draft === false;
    case GITHUB_QUICK_FILTER.RECENTLY_UPDATED:
      return isSameRange(query.updated, RECENTLY_UPDATED_RANGE);
    case GITHUB_QUICK_FILTER.STALE:
      return isSameRange(query.updated, STALE_RANGE);
  }
}

function toggleListValue<Value extends string>(
  values: Value[],
  value: Value
): Value[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

/**
 * Flips one quick filter. Filters that contradict it are replaced instead of
 * stacked: "assigned to me" clears "no assignee", "draft" clears "ready for
 * review", and the two update windows share one `updated:` qualifier.
 */
export function toggleGitHubQuickFilter(
  query: ParsedGitHubSearchQuery,
  filter: GitHubQuickFilter
): void {
  const active = isGitHubQuickFilterActive(query, filter);
  switch (filter) {
    case GITHUB_QUICK_FILTER.CREATED_BY_ME:
      toggleGitHubFacetValue(query, GITHUB_FACET.AUTHOR, "@me");
      return;
    case GITHUB_QUICK_FILTER.ASSIGNED_TO_ME:
      toggleGitHubFacetValue(query, GITHUB_FACET.ASSIGNEE, "@me");
      if (!active) {
        query.missing = query.missing.filter(
          (field) => field !== GITHUB_QUERY_MISSING.ASSIGNEE
        );
      }
      return;
    case GITHUB_QUICK_FILTER.REVIEW_REQUESTED_FROM_ME:
      toggleGitHubFacetValue(query, GITHUB_FACET.REVIEW_REQUESTED, "@me");
      return;
    case GITHUB_QUICK_FILTER.NO_ASSIGNEE:
      query.missing = toggleListValue(
        query.missing,
        GITHUB_QUERY_MISSING.ASSIGNEE
      );
      if (!active) query.assignees = [];
      return;
    case GITHUB_QUICK_FILTER.NO_LABEL:
      query.missing = toggleListValue(
        query.missing,
        GITHUB_QUERY_MISSING.LABEL
      );
      if (!active) query.labels = [];
      return;
    case GITHUB_QUICK_FILTER.LINKED_PR:
      query.linkedPullRequest = active ? null : true;
      return;
    case GITHUB_QUICK_FILTER.DRAFT:
      query.draft = active ? null : true;
      return;
    case GITHUB_QUICK_FILTER.READY_FOR_REVIEW:
      query.draft = active ? null : false;
      return;
    case GITHUB_QUICK_FILTER.RECENTLY_UPDATED:
      query.updated = active ? null : { ...RECENTLY_UPDATED_RANGE };
      return;
    case GITHUB_QUICK_FILTER.STALE:
      query.updated = active ? null : { ...STALE_RANGE };
      return;
  }
}

/** Qualifiers beyond scope, state and free text — what the funnel badge counts. */
export function countActiveGitHubFilters(
  query: ParsedGitHubSearchQuery
): number {
  const lists = [
    query.labels,
    query.excludedLabels,
    query.authors,
    query.excludedAuthors,
    query.assignees,
    query.excludedAssignees,
    query.milestones,
    query.reviewRequested,
    query.baseBranches,
    query.headBranches,
    query.ciStatuses,
    query.missing,
  ];
  const scalars = [
    query.draft,
    query.linkedPullRequest,
    query.comments,
    query.updated,
    query.created,
  ];
  return (
    lists.reduce((total, list) => total + list.length, 0) +
    scalars.filter((value) => value !== null).length
  );
}

/** Drops every filter qualifier, keeping scope, state and free text. */
export function clearGitHubFilters(query: ParsedGitHubSearchQuery): void {
  const { scope, state, freeText } = query;
  Object.assign(query, createEmptyGitHubSearchQuery(), {
    scope,
    state,
    freeText,
  });
}

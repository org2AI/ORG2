import type { OpsGitHubQueryState } from "./githubWorkItemsViewCache";

export const GITHUB_QUERY_SCOPE = {
  ALL: "all",
  ISSUE: "issue",
  PR: "pr",
} as const;

export const GITHUB_QUERY_STATE = {
  ALL: "all",
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
} as const;

export type GitHubQueryScope =
  (typeof GITHUB_QUERY_SCOPE)[keyof typeof GITHUB_QUERY_SCOPE];

export type GitHubIssuePageState = "open" | "closed";

/** `no:` qualifiers: the item has nothing set for that field. */
export const GITHUB_QUERY_MISSING = {
  ASSIGNEE: "assignee",
  LABEL: "label",
  MILESTONE: "milestone",
} as const;

export type GitHubQueryMissingField =
  (typeof GITHUB_QUERY_MISSING)[keyof typeof GITHUB_QUERY_MISSING];

export const GITHUB_QUERY_CI_STATUSES = [
  "success",
  "failure",
  "pending",
] as const;

export type GitHubQueryCiStatus = (typeof GITHUB_QUERY_CI_STATUSES)[number];

export const GITHUB_QUERY_RANGE_OPERATORS = [">=", "<=", ">", "<"] as const;

export type GitHubQueryRangeOperator =
  (typeof GITHUB_QUERY_RANGE_OPERATORS)[number];

/**
 * `comments:>5`, `updated:>=2026-09-01`, `created:2026-01-01..2026-02-01`, or
 * a relative age such as `updated:>7d`. Operands stay as typed so the query
 * round-trips; `githubWorkItemsQueryRanges` resolves them when matching.
 */
export type GitHubQueryRange =
  | { kind: "compare"; operator: GitHubQueryRangeOperator; operand: string }
  | { kind: "between"; from: string; to: string }
  | { kind: "exact"; operand: string };

export interface ParsedGitHubSearchQuery {
  scope: GitHubQueryScope;
  state: OpsGitHubQueryState | null;
  /** Every label must be present. */
  labels: string[];
  excludedLabels: string[];
  /** Any listed login matches; `@me` resolves to the viewer. */
  authors: string[];
  excludedAuthors: string[];
  assignees: string[];
  excludedAssignees: string[];
  milestones: string[];
  reviewRequested: string[];
  baseBranches: string[];
  headBranches: string[];
  ciStatuses: GitHubQueryCiStatus[];
  draft: boolean | null;
  /** `linked:pr` keeps issues with a linked pull request; `-linked:pr` drops them. */
  linkedPullRequest: boolean | null;
  missing: GitHubQueryMissingField[];
  comments: GitHubQueryRange | null;
  updated: GitHubQueryRange | null;
  created: GitHubQueryRange | null;
  freeText: string;
}

export function createEmptyGitHubSearchQuery(): ParsedGitHubSearchQuery {
  return {
    scope: GITHUB_QUERY_SCOPE.ALL,
    state: null,
    labels: [],
    excludedLabels: [],
    authors: [],
    excludedAuthors: [],
    assignees: [],
    excludedAssignees: [],
    milestones: [],
    reviewRequested: [],
    baseBranches: [],
    headBranches: [],
    ciStatuses: [],
    draft: null,
    linkedPullRequest: null,
    missing: [],
    comments: null,
    updated: null,
    created: null,
    freeText: "",
  };
}

interface GitHubSearchToken {
  value: string;
  raw: string;
}

function tokenizeGitHubSearchQuery(rawQuery: string): GitHubSearchToken[] {
  const tokens: GitHubSearchToken[] = [];
  let value = "";
  let raw = "";
  let quote: '"' | "'" | null = null;
  const flush = () => {
    if (!value && !raw) return;
    tokens.push({ value, raw });
    value = "";
    raw = "";
  };

  for (const char of rawQuery) {
    if (/\s/.test(char) && quote === null) {
      flush();
      continue;
    }
    raw += char;
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    value += char;
  }
  flush();
  return tokens;
}

function serializeGitHubTokenValue(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function serializeGitHubRange(range: GitHubQueryRange): string {
  if (range.kind === "compare") return `${range.operator}${range.operand}`;
  if (range.kind === "between") return `${range.from}..${range.to}`;
  return range.operand;
}

function parseGitHubRange(value: string): GitHubQueryRange | null {
  const betweenIndex = value.indexOf("..");
  if (betweenIndex >= 0) {
    const from = value.slice(0, betweenIndex);
    const to = value.slice(betweenIndex + 2);
    return from && to ? { kind: "between", from, to } : null;
  }
  const operator = GITHUB_QUERY_RANGE_OPERATORS.find((candidate) =>
    value.startsWith(candidate)
  );
  if (!operator) return { kind: "exact", operand: value };
  const operand = value.slice(operator.length);
  return operand ? { kind: "compare", operator, operand } : null;
}

function pushUnique(target: string[], values: string[]): void {
  for (const value of values) {
    const exists = target.some(
      (current) => current.toLowerCase() === value.toLowerCase()
    );
    if (!exists) target.push(value);
  }
}

/**
 * Logins and branches never contain commas, so `author:a,b` lists both. A
 * list still being typed (`author:a,`) is null: the caller keeps the token as
 * free text instead of rewriting it under the cursor.
 */
function parseQualifierList(value: string): string[] | null {
  const parts = value.split(",").map((part) => part.trim());
  return parts.every(Boolean) ? parts : null;
}

export function serializeGitHubSearchQuery(
  query: ParsedGitHubSearchQuery
): string {
  const parts: string[] = [];
  const pushAll = (prefix: string, values: string[]) => {
    for (const value of values) {
      parts.push(`${prefix}:${serializeGitHubTokenValue(value)}`);
    }
  };
  if (query.scope === GITHUB_QUERY_SCOPE.ISSUE) parts.push("is:issue");
  if (query.scope === GITHUB_QUERY_SCOPE.PR) parts.push("is:pr");
  if (query.state === GITHUB_QUERY_STATE.OPEN) parts.push("is:open");
  if (query.state === GITHUB_QUERY_STATE.CLOSED) parts.push("is:closed");
  if (query.state === GITHUB_QUERY_STATE.MERGED) parts.push("is:merged");
  if (query.state === GITHUB_QUERY_STATE.ALL) parts.push("state:all");
  if (query.draft !== null) parts.push(`draft:${query.draft}`);
  pushAll("assignee", query.assignees);
  pushAll("-assignee", query.excludedAssignees);
  pushAll("author", query.authors);
  pushAll("-author", query.excludedAuthors);
  pushAll("review-requested", query.reviewRequested);
  pushAll("label", query.labels);
  pushAll("-label", query.excludedLabels);
  pushAll("milestone", query.milestones);
  pushAll("no", query.missing);
  pushAll("base", query.baseBranches);
  pushAll("head", query.headBranches);
  pushAll("status", query.ciStatuses);
  if (query.linkedPullRequest !== null) {
    parts.push(query.linkedPullRequest ? "linked:pr" : "-linked:pr");
  }
  if (query.comments) {
    parts.push(`comments:${serializeGitHubRange(query.comments)}`);
  }
  if (query.updated) {
    parts.push(`updated:${serializeGitHubRange(query.updated)}`);
  }
  if (query.created) {
    parts.push(`created:${serializeGitHubRange(query.created)}`);
  }
  if (query.freeText) parts.push(query.freeText);
  return parts.join(" ");
}

/** Applies one `key:value` qualifier; false leaves the token as free text. */
function applyGitHubQualifier(
  query: ParsedGitHubSearchQuery,
  key: string,
  value: string,
  negated: boolean
): boolean {
  const normalizedValue = value.toLowerCase();
  if (key === "label") {
    pushUnique(negated ? query.excludedLabels : query.labels, [value]);
    return true;
  }
  if (key === "author" || key === "assignee") {
    const logins = parseQualifierList(value);
    if (!logins) return false;
    const [included, excluded] =
      key === "author"
        ? [query.authors, query.excludedAuthors]
        : [query.assignees, query.excludedAssignees];
    pushUnique(negated ? excluded : included, logins);
    return true;
  }
  if (key === "linked" && normalizedValue === "pr") {
    query.linkedPullRequest = !negated;
    return true;
  }
  if (key === "draft" && ["true", "false"].includes(normalizedValue)) {
    query.draft = (normalizedValue === "true") !== negated;
    return true;
  }
  if (key === "is" && normalizedValue === "draft") {
    query.draft = !negated;
    return true;
  }
  if (negated) return false;

  if (key === "milestone") {
    pushUnique(query.milestones, [value]);
    return true;
  }
  if (key === "review-requested" || key === "base" || key === "head") {
    const values = parseQualifierList(value);
    if (!values) return false;
    const target = {
      "review-requested": query.reviewRequested,
      base: query.baseBranches,
      head: query.headBranches,
    }[key];
    pushUnique(target, values);
    return true;
  }
  if (key === "status") {
    const statuses = parseQualifierList(normalizedValue);
    const known = (statuses ?? []).filter(
      (status): status is GitHubQueryCiStatus =>
        GITHUB_QUERY_CI_STATUSES.some((candidate) => candidate === status)
    );
    if (!statuses || known.length !== statuses.length) return false;
    pushUnique(query.ciStatuses, known);
    return true;
  }
  if (key === "no") {
    const field = Object.values(GITHUB_QUERY_MISSING).find(
      (candidate) => candidate === normalizedValue
    );
    if (!field) return false;
    pushUnique(query.missing, [field]);
    return true;
  }
  if (key === "comments" || key === "updated" || key === "created") {
    const range = parseGitHubRange(value);
    if (!range) return false;
    query[key] = range;
    return true;
  }
  if (key === "state") {
    if (
      normalizedValue === GITHUB_QUERY_STATE.OPEN ||
      normalizedValue === GITHUB_QUERY_STATE.CLOSED ||
      normalizedValue === GITHUB_QUERY_STATE.MERGED ||
      normalizedValue === GITHUB_QUERY_STATE.ALL
    ) {
      query.state = normalizedValue;
      return true;
    }
  }
  return false;
}

export function parseGitHubSearchQuery(
  rawQuery: string
): ParsedGitHubSearchQuery {
  const query = createEmptyGitHubSearchQuery();
  const freeTextTokens: string[] = [];
  let sawIssueScope = false;
  let sawPrScope = false;

  for (const { value: token, raw } of tokenizeGitHubSearchQuery(
    rawQuery.trim()
  )) {
    const normalized = token.toLowerCase();
    if (normalized === "is:issue") {
      sawIssueScope = true;
      query.scope = sawPrScope
        ? GITHUB_QUERY_SCOPE.ALL
        : GITHUB_QUERY_SCOPE.ISSUE;
      continue;
    }
    if (normalized === "is:pr" || normalized === "is:pull-request") {
      sawPrScope = true;
      query.scope = sawIssueScope
        ? GITHUB_QUERY_SCOPE.ALL
        : GITHUB_QUERY_SCOPE.PR;
      continue;
    }
    if (normalized === "is:open") {
      query.state = GITHUB_QUERY_STATE.OPEN;
      continue;
    }
    if (normalized === "is:closed") {
      query.state = GITHUB_QUERY_STATE.CLOSED;
      continue;
    }
    if (normalized === "is:merged") {
      query.scope = GITHUB_QUERY_SCOPE.PR;
      query.state = GITHUB_QUERY_STATE.MERGED;
      continue;
    }

    const negated = token.startsWith("-");
    const [rawKey, ...rest] = (negated ? token.slice(1) : token).split(":");
    const qualifierValue = rest.join(":").trim();
    if (
      !qualifierValue ||
      !applyGitHubQualifier(
        query,
        rawKey.toLowerCase(),
        qualifierValue,
        negated
      )
    ) {
      freeTextTokens.push(raw);
    }
  }

  query.freeText = freeTextTokens.join(" ").trim();
  return query;
}

export function getIssuePageStatesForQuery(
  query: ParsedGitHubSearchQuery
): GitHubIssuePageState[] {
  if (query.scope === GITHUB_QUERY_SCOPE.PR) return [];
  if (query.state === GITHUB_QUERY_STATE.OPEN) return ["open"];
  if (query.state === GITHUB_QUERY_STATE.CLOSED) return ["closed"];
  return ["open", "closed"];
}

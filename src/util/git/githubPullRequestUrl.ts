/**
 * github.com pull-request URL parsing shared by chat link handling and the
 * turn-metadata footer. Host-strict on purpose: GitHub Enterprise hosts are
 * not routed through the in-app PR flows.
 */

const GITHUB_PULL_REQUEST_URL_PATTERN =
  /^https?:\/\/(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+)\/pull\/(\d+)(?:[/?#][^\s]*)?$/i;

export interface GitHubPullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

/** `https://github.com/owner/repo/pull/851[/files?…#…]` → `{ owner, repo, number }`. */
export function parseGitHubPullRequestUrl(
  url: string
): GitHubPullRequestRef | null {
  const match = GITHUB_PULL_REQUEST_URL_PATTERN.exec(url.trim());
  if (!match) return null;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { owner: match[1], repo: match[2], number };
}

/** Keep local tab identities stable; remote-only PRs must include their repository. */
export function githubPullRequestTabKey(pr: {
  repoPath: string;
  prUrl: string;
  prNumber: number;
}): string {
  if (pr.repoPath) return `${pr.repoPath}:${pr.prNumber}`;
  const ref = parseGitHubPullRequestUrl(pr.prUrl);
  return ref && ref.number === pr.prNumber
    ? `github.com/${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}:${ref.number}`
    : `${pr.prUrl}:${pr.prNumber}`;
}

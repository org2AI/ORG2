import type { GitCommitInfo } from "@src/api/http/git/types";
import type { ExtractedGitArtifactData } from "@src/engines/SessionCore/core/types";

export type SubmissionArtifactOrigin = "created" | "mentioned";

export type SubmissionArtifact = ExtractedGitArtifactData & {
  repoId?: string;
  repoPath?: string;
  origin?: SubmissionArtifactOrigin;
  /** Event ID where this artifact was extracted from (for replay navigation). */
  eventId?: string;
};

export type SubmissionCommit = Pick<
  GitCommitInfo,
  "sha" | "short_sha" | "summary"
> & {
  author?: GitCommitInfo["author"] | null;
  repoId?: string;
  repoPath?: string;
  origin?: SubmissionArtifactOrigin;
  /** Event ID where this commit was first mentioned (extracted from text/shell, not orgtrack-linked). */
  mentionedEventId?: string;
};

export interface PullRequestSubmission {
  key: string;
  url?: string;
  repoFullName?: string;
  prNumber?: number;
  prTitle?: string;
  sourceBranch?: string;
  targetBranch?: string;
  origin?: SubmissionArtifactOrigin;
  /** Normalized PR status (`open` / `merged` / `closed` / `draft`), or
   * `unknown` when the GitHub read failed. Injected by the parent after a
   * batch GitHub fetch; absent while the first read is in flight, or for rows
   * missing repoFullName-or-prNumber, which can never be read. Those render as
   * `unknown` too — never as `open`, which would assert a state nothing
   * verified. */
  statusKey?: string;
}

export interface SubmissionsData {
  commits: SubmissionCommit[];
  pullRequests: PullRequestSubmission[];
}

function extractCommitSha(artifact: SubmissionArtifact): string {
  if (artifact.sha) return artifact.sha.trim();
  const match = artifact.url?.match(
    /github\.com\/[^/]+\/[^/]+\/commit\/([a-f0-9]{7,40})/i
  );
  return match?.[1] ?? "";
}

function commitFromArtifact(
  artifact: SubmissionArtifact
): SubmissionCommit | null {
  const sha = extractCommitSha(artifact);
  const shortSha = artifact.shortSha ?? sha.slice(0, 7);
  if (!sha && !shortSha) return null;
  return {
    sha: sha || shortSha,
    short_sha: shortSha || sha.slice(0, 7),
    summary: artifact.subject ?? shortSha ?? sha,
    author: null,
    repoId: artifact.repoId,
    repoPath: artifact.repoPath,
    origin: artifact.origin,
    mentionedEventId: artifact.eventId,
  };
}

function getSubmissionDedupeKey(artifact: SubmissionArtifact): string | null {
  if (artifact.url) return `${artifact.kind}:url:${artifact.url}`;
  if (artifact.kind === "commit" && artifact.sha)
    return `commit:sha:${artifact.sha}`;
  if (
    artifact.kind === "pullRequest" &&
    artifact.repoFullName &&
    artifact.prNumber
  ) {
    return `pullRequest:${artifact.repoFullName}#${artifact.prNumber}`;
  }
  return null;
}

export function deriveSubmissionsData(
  artifacts: readonly SubmissionArtifact[]
): SubmissionsData {
  const seenKeys = new Set<string>();
  const commits: SubmissionCommit[] = [];
  const pullRequests: PullRequestSubmission[] = [];

  for (const artifact of artifacts) {
    const key = getSubmissionDedupeKey(artifact);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);

    if (artifact.kind === "commit") {
      const commit = commitFromArtifact(artifact);
      if (commit) commits.push(commit);
      continue;
    }

    pullRequests.push({
      key,
      url: artifact.url,
      repoFullName: artifact.repoFullName,
      prNumber: artifact.prNumber,
      prTitle: artifact.prTitle,
      sourceBranch: artifact.sourceBranch,
      targetBranch: artifact.targetBranch,
      origin: artifact.origin,
    });
  }

  return { commits, pullRequests };
}

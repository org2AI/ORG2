import { describe, expect, it } from "vitest";

import { walkStaticImports } from "@src/test/staticImportGraph";

import { deriveSubmissionsData } from "../submissionsData";

describe("submissions data", () => {
  it("preserves commit navigation metadata, infers URL SHAs, and deduplicates first occurrence", () => {
    const result = deriveSubmissionsData([
      {
        kind: "commit",
        url: "https://github.com/acme/repo/commit/abcdef123456",
        subject: "First",
        repoId: "repo",
        repoPath: "/repo",
        origin: "mentioned",
        eventId: "event",
      },
      {
        kind: "commit",
        url: "https://github.com/acme/repo/commit/abcdef123456",
        subject: "Duplicate",
      },
      { kind: "commit" },
    ]);
    expect(result.commits).toEqual([
      {
        sha: "abcdef123456",
        short_sha: "abcdef1",
        summary: "First",
        author: null,
        repoId: "repo",
        repoPath: "/repo",
        origin: "mentioned",
        mentionedEventId: "event",
      },
    ]);
    expect(result.pullRequests).toEqual([]);
  });
  it("preserves PR references and leaves unread statuses unresolved", () => {
    const result = deriveSubmissionsData([
      {
        kind: "pullRequest",
        repoFullName: "acme/repo",
        prNumber: 42,
        prTitle: "First",
        sourceBranch: "feature",
        targetBranch: "develop",
        origin: "created",
      },
      {
        kind: "pullRequest",
        repoFullName: "acme/repo",
        prNumber: 42,
        prTitle: "Duplicate",
      },
    ]);
    expect(result.pullRequests).toEqual([
      {
        key: "pullRequest:acme/repo#42",
        repoFullName: "acme/repo",
        prNumber: 42,
        prTitle: "First",
        sourceBranch: "feature",
        targetBranch: "develop",
        origin: "created",
      },
    ]);
    expect(result.pullRequests[0]).not.toHaveProperty("statusKey");
  });
  it("derives data without loading renderers or runtime dependencies", () => {
    const graph = walkStaticImports([
      "modules/WorkStation/Diff/SessionReplay/submissionsData.ts",
    ]);
    expect(graph.files.size).toBe(1);
    expect(graph.packages.size).toBe(0);
  });
});

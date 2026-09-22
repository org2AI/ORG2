import { describe, expect, it } from "vitest";

import {
  NO_FILE_CHANGE_STATS,
  resolveImportedFileChangeStats,
} from "./chatViewFileChanges";

const emptySummary = { filesChanged: 0, linesAdded: 0, linesRemoved: 0 };

describe("resolveImportedFileChangeStats", () => {
  it("prefers the session summary over the sidebar row", () => {
    expect(
      resolveImportedFileChangeStats({
        summary: { filesChanged: 5, linesAdded: 4, linesRemoved: 3 },
        session: { filesChanged: 2, linesAdded: 1, linesRemoved: 1 },
      })
    ).toEqual({ count: 5, additions: 4, deletions: 3 });
  });

  it("uses the sidebar row while the summary is loading or empty", () => {
    const session = {
      filesChanged: 2,
      linesAdded: 7,
      linesRemoved: 1,
      touchedFiles: ["src/a.ts", "src/b.ts"],
    };
    const expected = { count: 2, additions: 7, deletions: 1 };

    expect(resolveImportedFileChangeStats({ summary: null, session })).toEqual(
      expected
    );
    expect(
      resolveImportedFileChangeStats({ summary: emptySummary, session })
    ).toEqual(expected);
  });

  it("counts touched files when the row carries paths but no file count", () => {
    expect(
      resolveImportedFileChangeStats({
        summary: null,
        session: { filesChanged: 0, touchedFiles: ["src/a.ts"] },
      })
    ).toEqual({ count: 1, additions: 0, deletions: 0 });
  });

  it("returns empty stats when no source recorded impact", () => {
    expect(
      resolveImportedFileChangeStats({
        summary: emptySummary,
        session: undefined,
      })
    ).toBe(NO_FILE_CHANGE_STATS);
  });
});

import { describe, expect, it } from "vitest";

import { buildFileBreadcrumbPathSegments } from "./breadcrumbPathSegments";

describe("buildFileBreadcrumbPathSegments", () => {
  it("resolves repo-relative files from the selected repo", () => {
    const segments = buildFileBreadcrumbPathSegments(
      "src/features/FileHeader/index.tsx",
      "/Users/dev/ORGII"
    );

    expect(
      segments.map(({ label, fullPath }) => ({ label, fullPath }))
    ).toEqual([
      { label: "src", fullPath: "/Users/dev/ORGII/src" },
      {
        label: "features",
        fullPath: "/Users/dev/ORGII/src/features",
      },
      {
        label: "FileHeader",
        fullPath: "/Users/dev/ORGII/src/features/FileHeader",
      },
      {
        label: "index.tsx",
        fullPath: "/Users/dev/ORGII/src/features/FileHeader/index.tsx",
      },
    ]);
  });

  it("keeps an external worktree path independent from the selected repo", () => {
    const worktreeFile =
      "/Users/dev/.orgii/agent-worktrees/orgii-a/agent-b/src/File.tsx";
    const segments = buildFileBreadcrumbPathSegments(
      worktreeFile,
      "/Users/dev/ORGII"
    );

    expect(segments.at(-2)?.fullPath).toBe(
      "/Users/dev/.orgii/agent-worktrees/orgii-a/agent-b/src"
    );
    expect(segments.at(-1)?.fullPath).toBe(worktreeFile);
    expect(
      segments.some(({ fullPath }) => fullPath.includes("ORGII/Users"))
    ).toBe(false);
  });

  it("keeps absolute files inside the selected repo repo-relative in display", () => {
    const segments = buildFileBreadcrumbPathSegments(
      "/Users/dev/ORGII/src/File.tsx",
      "/Users/dev/ORGII/"
    );

    expect(segments).toEqual([
      {
        label: "src",
        fullPath: "/Users/dev/ORGII/src",
        isLast: false,
      },
      {
        label: "File.tsx",
        fullPath: "/Users/dev/ORGII/src/File.tsx",
        isLast: true,
      },
    ]);
  });

  it("normalizes an external Windows worktree without changing its root", () => {
    const segments = buildFileBreadcrumbPathSegments(
      "\\\\?\\C:\\Users\\dev\\.orgii\\agent-worktrees\\agent-a\\src\\File.tsx",
      "C:\\Users\\dev\\ORGII"
    );

    expect(segments.at(-2)?.fullPath).toBe(
      "C:/Users/dev/.orgii/agent-worktrees/agent-a/src"
    );
    expect(segments.at(-1)?.fullPath).toBe(
      "C:/Users/dev/.orgii/agent-worktrees/agent-a/src/File.tsx"
    );
  });
});

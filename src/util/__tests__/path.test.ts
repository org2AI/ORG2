import { describe, expect, it } from "vitest";

import { basename, tildePath } from "../path";

describe("basename", () => {
  it("returns the last segment of POSIX and Windows paths", () => {
    expect(basename("/Users/me/project/")).toBe("project");
    expect(basename("C:\\work\\repo")).toBe("repo");
    expect(basename(undefined)).toBe("");
  });
});

describe("tildePath", () => {
  it("collapses macOS and Linux home prefixes", () => {
    expect(tildePath("/Users/me/.claude/projects")).toBe("~/.claude/projects");
    expect(tildePath("/home/me/.codex/sessions")).toBe("~/.codex/sessions");
    expect(tildePath("/Users/me")).toBe("~");
  });

  it("leaves other paths alone", () => {
    expect(tildePath("/opt/tools/bin")).toBe("/opt/tools/bin");
    expect(tildePath("/Users")).toBe("/Users");
    expect(tildePath("/var/Users/me/x")).toBe("/var/Users/me/x");
    expect(tildePath("C:\\Users\\me\\repo")).toBe("C:\\Users\\me\\repo");
  });
});

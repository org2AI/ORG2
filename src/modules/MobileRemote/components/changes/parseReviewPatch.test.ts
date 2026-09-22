import { describe, expect, it } from "vitest";

import { parseReviewPatch } from "./parseReviewPatch";

describe("review patch presentation boundary", () => {
  it("separates file envelopes and hunks from code with real old/new coordinates", () => {
    const hunks = parseReviewPatch(
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -12,3 +12,4 @@ function\n context\n-old\n+new\n+added\n tail\n"
    )!;
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      additions: 2,
      deletions: 1,
      oldStart: 12,
      newStart: 12,
    });
    expect(
      hunks[0].lines.map(({ kind, text, oldLine, newLine }) => [
        kind,
        text,
        oldLine,
        newLine,
      ])
    ).toEqual([
      ["context", "context", 12, 12],
      ["deleted", "old", 13, null],
      ["added", "new", null, 13],
      ["added", "added", null, 14],
      ["context", "tail", 14, 15],
    ]);
  });
  it("does not hide real code that resembles file headers", () => {
    const hunk = parseReviewPatch(
      "--- a\n+++ b\n@@ -1 +1 @@\n---old\n+++new\n"
    )![0];
    expect(hunk.lines.map((line) => line.text)).toEqual(["--old", "++new"]);
  });
  it("handles added/deleted files, CRLF, and missing final newlines", () => {
    const added = parseReviewPatch(
      "--- /dev/null\r\n+++ a\r\n@@ -0,0 +1,2 @@\r\n+one\r\n+two\r\n\\ No newline at end of file\r\n"
    )![0];
    expect(added.lines.map((line) => line.newLine)).toEqual([1, 2]);
    expect(added.lines[1].noNewline).toBe(true);
    expect(
      parseReviewPatch("--- a\n+++ /dev/null\n@@ -7,1 +0,0 @@\n-old")![0]
        .lines[0].oldLine
    ).toBe(7);
  });
  it("keeps distant hunks separate without materializing missing lines", () => {
    const hunks = parseReviewPatch(
      "@@ -1 +1 @@\n-a\n+b\n@@ -900000 +900000 @@\n-x\n+y\n"
    )!;
    expect(hunks.map((hunk) => hunk.lines.length)).toEqual([2, 2]);
    expect(hunks[1].lines[1].newLine).toBe(900000);
  });
  it.each([
    "Binary files a and b differ\n",
    "rename from a\nrename to b\n",
    "@@ -1,2 +1,2 @@\n-one\n+two\n",
    "@@ -1 +1 @@\n-one\n+two\n+extra\n",
    "@@ -0 +0 @@\n-x\n+y\n",
    "@@ -9007199254740992 +1 @@\n-x\n+y\n",
    "*** Begin Patch\n*** Add File: a\n+x\n*** End Patch",
  ])(
    "preserves unsupported or incomplete input via explicit raw fallback: %s",
    (patch) => {
      expect(parseReviewPatch(patch)).toBeNull();
    }
  );
  it("bounds parsing work before allocating a massive line model", () => {
    expect(parseReviewPatch("x".repeat(524289))).toBeNull();
    expect(parseReviewPatch("\n".repeat(10001))).toBeNull();
  });
});

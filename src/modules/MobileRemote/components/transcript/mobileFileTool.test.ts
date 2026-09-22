import { describe, expect, it } from "vitest";

import type { TranscriptItem } from "../../lib/transcriptReducer";
import {
  MOBILE_MERGE_MAX_CHARACTERS,
  mobileFilePreview,
  mobileFileTargets,
} from "./mobileFileTool";

describe("mobile file tool projection", () => {
  it("preserves authoritative apply-patch target indexes and line numbers", () => {
    const item: TranscriptItem = {
      id: "edit-1",
      kind: "tool",
      text: "apply_patch",
      toolData: {
        kind: "edit",
        filePath: "unused.ts",
        fileName: "unused.ts",
        language: "typescript",
        isDeleted: false,
        applyPatchSegments: [
          {
            filePath: "src/a.ts",
            fileName: "a.ts",
            language: "typescript",
            newStartLine: 3,
            diff: "@@ -3 +3 @@\n-old\n+new",
            isDeleted: false,
            applyPatchSegments: [],
          },
          {
            filePath: "src/b.ts",
            fileName: "b.ts",
            language: "typescript",
            newStartLine: 9,
            newContent: "export const b = true;",
            isDeleted: false,
            applyPatchSegments: [],
          },
        ],
      },
    };

    expect(mobileFileTargets(item)).toEqual([
      expect.objectContaining({
        targetIndex: 0,
        filePath: "src/a.ts",
        line: 3,
      }),
      expect.objectContaining({
        targetIndex: 1,
        filePath: "src/b.ts",
        line: 9,
      }),
    ]);
  });

  it.each(["", "  \n\t", "const value = '<safe>';\n"])(
    "preserves exact new content %j instead of stale old content",
    (content) => {
      const targets = mobileFileTargets({
        id: "empty-edit",
        kind: "tool",
        text: "edit_file",
        toolData: {
          kind: "edit",
          filePath: "src/empty.ts",
          fileName: "empty.ts",
          language: "typescript",
          newContent: content,
          oldContent: "stale content",
          isDeleted: false,
          applyPatchSegments: [],
        },
      });
      expect(targets[0]?.content).toBe(content);
      expect(targets[0]?.newContent).toBe(content);
      expect(targets[0]?.oldContent).toBe("stale content");
      expect(mobileFilePreview(targets[0]!, false)).toEqual({
        kind: "merge",
        content,
        original: "stale content",
      });
    }
  );

  it("retains each patch segment's canonical pair, including added and deleted files", () => {
    const targets = mobileFileTargets({
      id: "patch",
      kind: "tool",
      text: "apply_patch",
      toolData: {
        kind: "edit",
        filePath: "a.ts",
        fileName: "a.ts",
        language: "typescript",
        isDeleted: false,
        applyPatchSegments: [
          {
            filePath: "a.ts",
            fileName: "a.ts",
            language: "typescript",
            oldContent: "",
            newContent: "const a = 1;",
            isDeleted: false,
            applyPatchSegments: [],
          },
          {
            filePath: "b.ts",
            fileName: "b.ts",
            language: "typescript",
            oldContent: "const b = 2;",
            newContent: "",
            isDeleted: true,
            applyPatchSegments: [],
          },
        ],
      },
    });
    expect(targets.map((target) => mobileFilePreview(target, false))).toEqual([
      { kind: "merge", content: "const a = 1;", original: "" },
      { kind: "merge", content: "", original: "const b = 2;" },
    ]);
  });

  it("never treats a missing side, independently truncated pair or oversized pair as a complete comparison", () => {
    const target = {
      targetIndex: 0,
      filePath: "a.ts",
      fileName: "a.ts",
      diff: "@@ -1 +1 @@\n-a\n+b",
      oldContent: "a",
      newContent: "b",
      content: "b",
    };
    for (const [input, truncated] of [
      [{ ...target, oldContent: undefined }, false],
      [{ ...target, newContent: undefined }, false],
      [target, true],
      [
        { ...target, oldContent: "a".repeat(MOBILE_MERGE_MAX_CHARACTERS) },
        false,
      ],
    ] as const) {
      expect(mobileFilePreview(input, truncated)).toEqual({
        kind: "patch",
        content: target.diff,
        original: undefined,
      });
    }
    expect(
      mobileFilePreview(
        { ...target, oldContent: undefined, diff: undefined },
        false
      )
    ).toEqual({ kind: "snapshot", content: "b", original: undefined });
  });
});

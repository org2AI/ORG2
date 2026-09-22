import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { beforeEach, expect, it, vi } from "vitest";

import { replaceSearchFile } from "./replaceSearchFile";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(async () => {}),
}));
const options = {
  caseSensitive: false,
  wholeWord: true,
  useRegex: true,
  fileExtensions: [],
  excludeDirs: [],
  filesToInclude: "",
  filesToExclude: "",
  onlyOpenFiles: false,
};
function file(text: string, column: number, before: string, after: string) {
  return {
    file_path: "/fixture/search.txt",
    matches: [
      {
        line: 1,
        end_line: 1,
        column,
        end_column: column + text.length,
        text,
        context_before: before,
        context_after: after,
      },
    ],
  };
}
beforeEach(() => vi.clearAllMocks());
it("writes only verified native whole-word ranges, including Unicode word neighbours", async () => {
  vi.mocked(readTextFile).mockResolvedValue("cat scatter écat caté");
  await replaceSearchFile(
    file("cat", 1, "", " scatter écat caté"),
    "cat",
    "dog",
    options
  );
  expect(writeTextFile).toHaveBeenCalledWith(
    "/fixture/search.txt",
    "dog scatter écat caté"
  );
});
it("preserves regex capture replacements and empty replacement", async () => {
  vi.mocked(readTextFile).mockResolvedValue("cat scatter");
  await replaceSearchFile(
    file("cat", 1, "", " scatter"),
    "(c)(at)",
    "$2$1",
    options
  );
  expect(writeTextFile).toHaveBeenLastCalledWith(
    "/fixture/search.txt",
    "atc scatter"
  );
  await replaceSearchFile(file("cat", 1, "", " scatter"), "cat", "", options);
  expect(writeTextFile).toHaveBeenLastCalledWith(
    "/fixture/search.txt",
    " scatter"
  );
});
it("refuses a stale snapshot before any producing write and allows a refreshed retry", async () => {
  vi.mocked(readTextFile).mockResolvedValue("cat changed");
  await expect(
    replaceSearchFile(file("cat", 1, "", " scatter"), "cat", "dog", options)
  ).rejects.toThrow("changed");
  expect(writeTextFile).not.toHaveBeenCalled();
  await replaceSearchFile(
    file("cat", 1, "", " changed"),
    "cat",
    "dog",
    options
  );
  expect(writeTextFile).toHaveBeenCalledWith(
    "/fixture/search.txt",
    "dog changed"
  );
});
it("keeps line-anchored regex captures valid beyond the first line", async () => {
  vi.mocked(readTextFile).mockResolvedValue("skip\ncat\r\n");
  const result = file("cat", 1, "", "");
  result.matches[0].line = 2;
  result.matches[0].end_line = 2;
  await replaceSearchFile(result, "^(cat)$", "$1!", options);
  expect(writeTextFile).toHaveBeenCalledWith(
    "/fixture/search.txt",
    "skip\ncat!\r\n"
  );
});
it("rejects partial/loading/error Replace All before reads or writes, then accepts complete retry", async () => {
  const { replaceSearchResults } = await import("./replaceSearchFile");
  const state = {
    loading: false,
    hasMore: false,
    isTruncated: false,
    error: null as string | null,
  };
  const results = [file("cat", 1, "", "")];
  for (const partial of [
    { hasMore: true },
    { isTruncated: true },
    { loading: true },
    { error: "budget" },
  ]) {
    await expect(
      replaceSearchResults(results, "cat", "dog", options, {
        ...state,
        ...partial,
      })
    ).rejects.toThrow("incomplete");
  }
  expect(readTextFile).not.toHaveBeenCalled();
  expect(writeTextFile).not.toHaveBeenCalled();
  vi.mocked(readTextFile).mockResolvedValue("cat");
  await replaceSearchResults(results, "cat", "dog", options, state);
  expect(writeTextFile).toHaveBeenCalledWith("/fixture/search.txt", "dog");
});

/**
 * Tests for search result transformers.
 */
import { describe, expect, it } from "vitest";

import {
  buildSearchFilters,
  parseFilePatterns,
  toUIOptions,
  toUIResult,
} from "../transformers";

describe("search transformers", () => {
  describe("toUIResult", () => {
    it("converts store result to UI format", () => {
      const storeResult = {
        file_path: "/repo/src/file.ts",
        matches: [
          {
            line: 10,
            column: 5,
            end_line: 10,
            end_column: 15,
            text: "const foo = bar",
            context_before: "// comment",
            context_after: "// after",
          },
        ],
      };

      const uiResult = toUIResult(storeResult);

      expect(uiResult.file_path).toBe("/repo/src/file.ts");
      expect(uiResult.matches).toHaveLength(1);
      expect(uiResult.matches[0].line).toBe(10);
      expect(uiResult.matches[0].text).toBe("const foo = bar");
    });
  });

  describe("toUIOptions", () => {
    it("converts store options to UI format with defaults", () => {
      const storeOptions = {
        caseSensitive: true,
        wholeWord: false,
        useRegex: true,
        fileExtensions: [".ts", ".tsx"],
        excludeDirs: ["node_modules"],
        filesToInclude: "src/**",
        filesToExclude: "**/*.test.ts",
        onlyOpenFiles: false,
      };

      const uiOptions = toUIOptions(storeOptions);

      expect(uiOptions.caseSensitive).toBe(true);
      expect(uiOptions.useRegex).toBe(true);
      expect(uiOptions.fileExtensions).toEqual([".ts", ".tsx"]);
      expect(uiOptions.offset).toBe(0);
      expect(uiOptions.filesToInclude).toBe("src/**");
    });
  });

  describe("parseFilePatterns", () => {
    it("parses comma-separated patterns", () => {
      const patterns = parseFilePatterns("*.ts, *.tsx, *.js");

      expect(patterns).toEqual(["*.ts", "*.tsx", "*.js"]);
    });

    it("trims whitespace", () => {
      const patterns = parseFilePatterns("  *.ts  ,  *.js  ");

      expect(patterns).toEqual(["*.ts", "*.js"]);
    });

    it("filters empty patterns", () => {
      const patterns = parseFilePatterns("*.ts,,*.js,");

      expect(patterns).toEqual(["*.ts", "*.js"]);
    });

    it("returns empty array for undefined input", () => {
      expect(parseFilePatterns(undefined)).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      expect(parseFilePatterns("")).toEqual([]);
    });
  });

  describe("buildSearchFilters", () => {
    it("builds backend filters from store options", () => {
      const filters = buildSearchFilters(
        {
          caseSensitive: true,
          wholeWord: true,
          useRegex: false,
          fileExtensions: [".ts"],
          excludeDirs: ["node_modules"],
          filesToInclude: "",
          filesToExclude: "dist",
          onlyOpenFiles: false,
        },
        [],
        ["dist"]
      );

      expect(filters.case_sensitive).toBe(true);
      expect(filters.whole_word).toBe(true);
      expect(filters.use_regex).toBe(false);
      expect(filters.file_extensions).toEqual([".ts"]);
      expect(filters.exclude_dirs).toEqual(["node_modules", "dist"]);
      expect(filters.exclude_globs).toEqual(["dist"]);
    });
  });
});

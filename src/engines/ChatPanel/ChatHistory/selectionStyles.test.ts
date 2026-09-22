import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("chat transcript selection styles", () => {
  it("uses the shared text-selection token for specific Markdown selectors", () => {
    const styles = readFileSync(resolve(__dirname, "index.scss"), "utf8");
    const markdownSelectionRule = styles.match(
      /\.chat-markdown-body[\s\S]*?code span::selection \{([\s\S]*?)\n\s{2}\}/
    )?.[1];

    expect(markdownSelectionRule).toContain("--text-selection");
    expect(markdownSelectionRule).not.toContain("--terminal-selection");
  });

  it("does not paint selection backgrounds on layout wrappers", () => {
    const styles = readFileSync(resolve(__dirname, "index.scss"), "utf8");
    const deepSelectionRule = styles.match(
      /\.allow-select-deep\s+:is\(([^)]*)\)::selection \{([\s\S]*?)\n\s{2}\}/
    );

    expect(deepSelectionRule?.[1]).toContain("span");
    expect(deepSelectionRule?.[1]).not.toContain("*");
    expect(deepSelectionRule?.[2]).toContain("--text-selection");
    expect(styles).not.toContain(".allow-select-deep *::selection");
  });

  it("keeps layout wrappers inert while allowing semantic text elements", () => {
    const styles = readFileSync(resolve(__dirname, "index.scss"), "utf8");
    const wrapperRule = styles.match(
      /\.allow-select-deep \* \{([\s\S]*?)\n\s{2}\}/
    )?.[1];
    const textAllowlist = styles.match(
      /\.allow-select-deep\s+:is\(([^)]*)\),\n\s{2}\.question-text/
    )?.[1];

    expect(wrapperRule).toContain("user-select: none !important");
    expect(textAllowlist).toContain("span");
    expect(textAllowlist).toContain("time");
  });

  it("keeps event block headers inert inside allow-select-deep items", () => {
    const styles = readFileSync(resolve(__dirname, "index.scss"), "utf8");
    const headerRule = styles.match(
      /\.allow-select-deep \.chat-block-header,\n\s{2}\.allow-select-deep \.chat-block-header \* \{([\s\S]*?)\n\s{2}\}/
    )?.[1];
    const headerPaintRule = styles.match(
      /\.allow-select-deep \.chat-block-header::selection,\n\s{2}\.allow-select-deep \.chat-block-header \*::selection \{([\s\S]*?)\n\s{2}\}/
    )?.[1];

    // `.allow-select-deep :is(span, …)` is (0,2,1) and would otherwise beat the
    // (0,2,0) `.chat-block-header *` reset at the top of the file.
    expect(headerRule).toContain("user-select: none !important");
    expect(headerRule).toContain("-webkit-user-select: none !important");
    expect(headerPaintRule).toContain("background: transparent !important");
  });

  it.each(["orgii_main.css", "orgii_dark.css"])(
    "defines a visible text-selection color in %s",
    (themeFile) => {
      const theme = readFileSync(resolve("public", themeFile), "utf8");
      expect(theme).toMatch(/--text-selection:\s*#[0-9a-f]{6}/i);
    }
  );
});

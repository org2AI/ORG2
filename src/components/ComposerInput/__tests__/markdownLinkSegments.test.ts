import { describe, expect, it } from "vitest";

import {
  type MarkdownSegment,
  findUrlWordEndingAt,
  segmentMarkdownLinks,
} from "../markdownLinkSegments";

/** Rebuild the input from its segments — nothing may be lost or reordered. */
function rejoin(segments: MarkdownSegment[]): string {
  return segments
    .map((segment) =>
      segment.kind === "text"
        ? segment.text
        : segment.label
          ? `[${segment.label}](${segment.url})`
          : segment.url
    )
    .join("");
}

function links(markdown: string): { label: string; url: string }[] {
  return segmentMarkdownLinks(markdown).flatMap((segment) =>
    segment.kind === "link" ? [{ label: segment.label, url: segment.url }] : []
  );
}

describe("segmentMarkdownLinks", () => {
  it("splits a link out of surrounding prose", () => {
    expect(segmentMarkdownLinks("see [the doc](https://a.test/x) now")).toEqual(
      [
        { kind: "text", text: "see " },
        { kind: "link", label: "the doc", url: "https://a.test/x" },
        { kind: "text", text: " now" },
      ]
    );
  });

  it("finds a bare url", () => {
    expect(links("go to https://a.test/x today")).toEqual([
      { label: "", url: "https://a.test/x" },
    ]);
  });

  it("leaves trailing sentence punctuation out of a bare url", () => {
    expect(links("see https://a.test/x.")).toEqual([
      { label: "", url: "https://a.test/x" },
    ]);
  });

  it("only treats a bare url as a link when it is its own word", () => {
    // A stack frame or a fetch call must reach the agent exactly as pasted.
    expect(links("at run (http://localhost:1998/main.js:12:4)")).toEqual([]);
    expect(links('fetch("https://api.test/v1")')).toEqual([]);
    expect(links("url=https://a.test/x")).toEqual([]);
    expect(links("line one\nhttps://a.test/x")).toEqual([
      { label: "", url: "https://a.test/x" },
    ]);
  });

  it("unwraps an angle-bracketed target", () => {
    expect(links("[L](<https://a.test/a b>)")).toEqual([
      { label: "L", url: "https://a.test/a b" },
    ]);
  });

  it("keeps images as text", () => {
    const markdown = "![shot](https://a.test/i.png)";
    expect(links(markdown)).toEqual([]);
    expect(rejoin(segmentMarkdownLinks(markdown))).toBe(markdown);
  });

  it("ignores links inside a fenced code block", () => {
    const markdown = [
      "before [a](https://a.test/1)",
      "```ts",
      'const url = "https://a.test/2";',
      "const md = [b](https://a.test/3);",
      "```",
      "after [c](https://a.test/4)",
    ].join("\n");
    expect(links(markdown).map((l) => l.url)).toEqual([
      "https://a.test/1",
      "https://a.test/4",
    ]);
    expect(rejoin(segmentMarkdownLinks(markdown))).toBe(markdown);
  });

  it("honours a longer closing fence and tilde fences", () => {
    const markdown = [
      "````",
      "```",
      "[a](https://a.test/1)",
      "````",
      "[b](https://a.test/2)",
      "~~~",
      "[c](https://a.test/3)",
      "~~~",
      "[d](https://a.test/4)",
    ].join("\n");
    expect(links(markdown).map((l) => l.url)).toEqual([
      "https://a.test/2",
      "https://a.test/4",
    ]);
  });

  it("ignores links inside an inline code span", () => {
    const markdown = "run `[a](https://a.test/1)` then [b](https://a.test/2)";
    expect(links(markdown).map((l) => l.url)).toEqual(["https://a.test/2"]);
    expect(rejoin(segmentMarkdownLinks(markdown))).toBe(markdown);
  });

  it("handles nested brackets in a label", () => {
    expect(links("[a [nested] b](https://a.test/1)")).toEqual([
      { label: "a [nested] b", url: "https://a.test/1" },
    ]);
  });

  it("treats an unclosed link as literal text", () => {
    const markdown = "[not a link and no target";
    expect(links(markdown)).toEqual([]);
    expect(rejoin(segmentMarkdownLinks(markdown))).toBe(markdown);
  });

  it("round-trips a multi-line list without losing newlines", () => {
    const markdown = [
      "- [one](https://a.test/1)",
      "  #1 · [author](https://a.test/a) opened today",
      "- [two](https://a.test/2)",
    ].join("\n");
    expect(rejoin(segmentMarkdownLinks(markdown))).toBe(markdown);
    expect(links(markdown)).toHaveLength(3);
  });

  it("returns nothing for empty input", () => {
    expect(segmentMarkdownLinks("")).toEqual([]);
  });
});

describe("findUrlWordEndingAt", () => {
  it("finds the address that ends at the caret", () => {
    const text = "see https://a.test/x";
    expect(findUrlWordEndingAt(text, text.length)).toEqual({
      url: "https://a.test/x",
      trailing: "",
      start: 4,
    });
  });

  it("leaves typed sentence punctuation outside the address", () => {
    const text = "go https://a.test.";
    expect(findUrlWordEndingAt(text, text.length)).toEqual({
      url: "https://a.test",
      trailing: ".",
      start: 3,
    });
  });

  it("only matches a whole word and a real address", () => {
    expect(findUrlWordEndingAt("(https://a.test", 15)).toBeNull();
    expect(findUrlWordEndingAt("https://", 8)).toBeNull();
    expect(findUrlWordEndingAt("see https://a.test more", 10)).toBeNull();
  });

  it("measures against the caret, not the end of the text", () => {
    const text = "https://a.test/x END";
    expect(findUrlWordEndingAt(text, 16)?.url).toBe("https://a.test/x");
  });
});

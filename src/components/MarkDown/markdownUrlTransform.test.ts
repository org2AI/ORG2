import { defaultUrlTransform } from "react-markdown";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  registerMarkdownExtensions,
  resetMarkdownExtensions,
} from "./extensions";
import { markdownUrlTransform } from "./markdownUrlTransform";

/**
 * Shaped like the real `orgii://cloud/session/ref` grammar, but declared here
 * as a literal: which scheme is a reference is the registering tier's
 * business, not the renderer's. This suite pins the transform's own rule —
 * an owned href survives on `href` and nowhere else.
 */
const REFERENCE =
  "orgii://cloud/session/ref?v=1&org=0830d453-1111-4222-8333-444455556666&owner=6c6a39b1-4ca5-4c48-89b4-74d1565c258d&session=sdeagent-1784668132283";

describe("markdown url transform", () => {
  beforeEach(() => {
    registerMarkdownExtensions({
      ownsReferenceHref: (href) => href === REFERENCE,
    });
  });
  afterEach(() => {
    resetMarkdownExtensions();
  });

  it("sanitizes an owned scheme when no tier registered it", () => {
    resetMarkdownExtensions();
    expect(markdownUrlTransform(REFERENCE, "href")).toBe("");
  });

  it("proves the default sanitizer would drop a session reference", () => {
    expect(defaultUrlTransform(REFERENCE)).toBe("");
  });

  it("proves the default sanitizer would drop supported local href forms", () => {
    expect(defaultUrlTransform("file:///Users/me/project/View.tsx:220")).toBe(
      ""
    );
    expect(defaultUrlTransform("C:\\repo\\src\\View.tsx:220")).toBe("");
    expect(defaultUrlTransform("WebsiteCard.tsx:84")).toBe("");
  });

  it("passes a valid session reference through on a link href", () => {
    expect(markdownUrlTransform(REFERENCE, "href")).toBe(REFERENCE);
  });

  it("passes projected composer references through on link hrefs", () => {
    const workItem = "workitem://auth/AUTH-12/1700000000000";
    expect(markdownUrlTransform(workItem, "href")).toBe(workItem);
    expect(markdownUrlTransform(workItem, "src")).toBe("");
  });

  it.each([
    "/Users/me/project/View.tsx:220",
    "file:///Users/me/project/View.tsx:220",
    "C:\\repo\\src\\View.tsx:220",
    "asset://localhost/Users/me/project/View.tsx:220",
    "~/project/View.tsx:220",
  ])("passes a supported local file reference through on href: %s", (href) => {
    expect(markdownUrlTransform(href, "href")).toBe(href);
  });

  it.each([
    "WebsiteCard.tsx:84",
    "src/components/MarkDown/LinkHoverCard.tsx:80",
    "docs/architecture.md",
  ])("preserves a workspace-relative file href: %s", (href) => {
    expect(markdownUrlTransform(href, "href")).toBe(href);
  });

  it("refuses the scheme on every non-href url attribute", () => {
    // react-markdown runs the transform over src/poster/cite too; only the
    // link path has a reference renderer, so nothing else may carry the scheme.
    for (const key of ["src", "poster", "cite", "action", undefined]) {
      expect(markdownUrlTransform(REFERENCE, key)).toBe("");
    }
  });

  it("keeps local-only schemes blocked on non-href attributes", () => {
    for (const value of [
      "file:///Users/me/project/View.tsx",
      "C:\\repo\\src\\View.tsx",
      "asset://localhost/Users/me/project/View.tsx",
    ]) {
      expect(markdownUrlTransform(value, "src")).toBe("");
    }
  });

  it("keeps sanitizing every other scheme, including near-misses", () => {
    expect(markdownUrlTransform("javascript:alert(1)", "href")).toBe("");
    expect(markdownUrlTransform("data:text/html,<script>", "href")).toBe("");
    expect(markdownUrlTransform("orgii://cloud/session?share=deadbeef")).toBe(
      ""
    );
    expect(
      markdownUrlTransform(
        "orgii://cloud/session/ref?v=2&org=a&owner=b&session=c"
      )
    ).toBe("");
  });

  it("leaves ordinary links alone", () => {
    expect(markdownUrlTransform("https://github.com/org2AI/ORG2")).toBe(
      "https://github.com/org2AI/ORG2"
    );
    expect(markdownUrlTransform("./relative/path.md")).toBe(
      "./relative/path.md"
    );
  });
});

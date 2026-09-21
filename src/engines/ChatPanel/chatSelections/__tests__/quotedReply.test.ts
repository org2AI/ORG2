import { describe, expect, it } from "vitest";

import {
  QUOTED_REPLY_TEXT_LIMIT,
  formatQuotedSelection,
  prependQuotedSelection,
} from "../quotedReply";

describe("formatQuotedSelection", () => {
  it("quotes every line, including the blank ones", () => {
    expect(formatQuotedSelection("first\n\nsecond")).toBe(
      "> first\n>\n> second"
    );
  });

  it("yields nothing for a whitespace-only selection", () => {
    expect(formatQuotedSelection("  \n ")).toBe("");
  });

  it("caps a very long passage", () => {
    const quoted = formatQuotedSelection("z".repeat(5000));
    expect(quoted).toBe(`> ${"z".repeat(QUOTED_REPLY_TEXT_LIMIT)}`);
  });
});

describe("prependQuotedSelection", () => {
  it("separates the quote from the reply with a blank line", () => {
    expect(prependQuotedSelection("what about this?", "the passage")).toBe(
      "> the passage\n\nwhat about this?"
    );
  });

  it("returns the message untouched when there is no quote", () => {
    expect(prependQuotedSelection("hello", "   ")).toBe("hello");
  });

  it("keeps a bodyless reply to the quote alone", () => {
    expect(prependQuotedSelection("", "the passage")).toBe("> the passage");
  });
});

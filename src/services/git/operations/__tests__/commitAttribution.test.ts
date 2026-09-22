import { describe, expect, it } from "vitest";

import {
  ORGII_COAUTHOR_EMAIL,
  appendGitCoauthorTrailer,
  appendPullRequestAttributionFooter,
} from "../commitAttribution";

describe("ORG2 attribution branding", () => {
  it("uses ORG2 while preserving the existing GitHub account", () => {
    expect(ORGII_COAUTHOR_EMAIL).toBe("ORGII-agent@users.noreply.github.com");
    const trailer = `Co-authored-by: ORG2 <${ORGII_COAUTHOR_EMAIL}>`;
    expect(appendGitCoauthorTrailer("Update UI")).toBe(
      `Update UI\n\n${trailer}`
    );
    expect(appendPullRequestAttributionFooter()).toBe(
      `Created with ORG2\n\n${trailer}`
    );
  });

  it.each(["ORGII", "ORG2"])(
    "does not duplicate existing %s attribution",
    (name) => {
      const existing = `Update UI\n\nCo-authored-by: ${name} <${ORGII_COAUTHOR_EMAIL}>`;
      expect(appendGitCoauthorTrailer(existing)).toBe(existing);
      expect(appendPullRequestAttributionFooter(existing)).toBe(existing);
    }
  );
});

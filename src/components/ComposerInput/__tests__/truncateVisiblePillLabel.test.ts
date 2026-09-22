import { describe, expect, it } from "vitest";

import { truncateVisibleLinkLabel, truncateVisiblePillLabel } from "../utils";

describe("truncateVisiblePillLabel", () => {
  it("leaves short labels alone", () => {
    expect(truncateVisiblePillLabel("sudomaggie")).toBe("sudomaggie");
  });

  it("keeps a file's extension visible", () => {
    expect(truncateVisiblePillLabel("useComposerInput.ts")).toBe(
      "useCompose....ts"
    );
    expect(truncateVisiblePillLabel("ComposerPill.index.tsx")).toBe(
      "ComposerPi....index.tsx"
    );
  });

  it("does not mistake a URL's host and path for an extension", () => {
    // The last dot sits in the host, so everything after it is the path and
    // query — repeating it produced "github.com....com/org2AI/…".
    expect(
      truncateVisiblePillLabel(
        "github.com/org2AI/ORG2/pulls?q=is%3Apr+state%3Aopen"
      )
    ).toBe("github.com...");
    expect(
      truncateVisiblePillLabel("wiportal.wiwide.com/portal?res=notyet")
    ).toBe("wiportal.w...");
  });

  it("ignores a leading dot", () => {
    expect(truncateVisiblePillLabel(".eslintrc-overrides")).toBe(
      ".eslintrc-..."
    );
  });
});

describe("truncateVisibleLinkLabel", () => {
  it("shows an ordinary address in full, scheme included", () => {
    expect(truncateVisibleLinkLabel("https://github.com")).toBe(
      "https://github.com"
    );
  });

  it("does not treat a TLD as a file extension", () => {
    const label = "https://example.com/a/rather/long/path/that/keeps/going";
    const shown = truncateVisibleLinkLabel(label);
    expect(shown).toBe(`${label.slice(0, 48)}...`);
    expect(shown.endsWith(".com")).toBe(false);
  });
});

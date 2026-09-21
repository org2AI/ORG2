import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import UserMessageContent, {
  normalizeMarkdownReferencePills,
  parseUserMessage,
} from "../UserMessageContent";

describe("external-history Markdown URL pills", () => {
  it("renders sent text without a blank first line and preserves paragraph spacing", () => {
    const html = renderToStaticMarkup(
      createElement(UserMessageContent, {
        text: "\n \t\n    first line\n\n  next line\n",
      })
    );
    expect(html).toContain(">    first line\n\n  next line\n</span>");
  });

  it("normalizes a self-labelled GitHub issue link to the native issue pill", () => {
    const url = "https://github.com/org2AI/ORG2/issues/556";

    expect(normalizeMarkdownReferencePills(`[${url}](${url})`)).toBe(
      `org2AI/ORG2#556 [issue:${url}]`
    );
    expect(parseUserMessage(`[${url}](${url})`)).toEqual([
      {
        kind: "pill",
        displayName: "org2AI/ORG2#556",
        pillType: "issue",
        path: url,
        terminalText: undefined,
      },
    ]);
  });

  it("normalizes a generic self-labelled HTTP link to the native link pill", () => {
    const url = "https://example.com/docs/getting-started?view=full#install";

    expect(normalizeMarkdownReferencePills(`Open [${url}](${url}) next.`)).toBe(
      `Open example.com/docs/getting-started?view=full#install [link:${url}] next.`
    );
  });

  it("normalizes labelled web, file, folder, and session references", () => {
    expect(
      normalizeMarkdownReferencePills(
        "[Issue 556](https://github.com/org2AI/ORG2/issues/556)"
      )
    ).toBe("org2AI/ORG2#556 [issue:https://github.com/org2AI/ORG2/issues/556]");
    expect(
      normalizeMarkdownReferencePills(
        "[some file.ts](file:///repo/some%20file.ts)"
      )
    ).toBe("some-file.ts [file:/repo/some file.ts]");
    expect(normalizeMarkdownReferencePills("[fixtures](/repo/fixtures/)")).toBe(
      "fixtures [folder:/repo/fixtures/]"
    );
    expect(
      normalizeMarkdownReferencePills(
        "[Previous session](session://sdeagent-abc/42)"
      )
    ).toBe("Previous-session [session:sdeagent-abc]");
  });

  it("converts a generated external attachment envelope before parsing", () => {
    expect(
      parseUserMessage(
        [
          "# Files mentioned by the user:",
          "",
          "## report.pdf: /tmp/report.pdf",
          "",
          "## My request for Codex:",
          "Review it.",
        ].join("\n")
      )
    ).toEqual([
      {
        kind: "pill",
        displayName: "report.pdf",
        pillType: "file",
        path: "/tmp/report.pdf",
        terminalText: undefined,
      },
      { kind: "text", text: "\n\nReview it." },
    ]);
  });

  it("leaves images, escaped Markdown, and unsafe URLs alone", () => {
    const image = "![https://example.com/a.png](https://example.com/a.png)";
    const escaped = String.raw`\[https://example.com](https://example.com)`;
    const credentialed =
      "[https://user:secret@example.com](https://user:secret@example.com)";

    expect(normalizeMarkdownReferencePills(image)).toBe(image);
    expect(normalizeMarkdownReferencePills(escaped)).toBe(escaped);
    expect(normalizeMarkdownReferencePills(credentialed)).toBe(credentialed);
  });
});

describe("message reference interactions", () => {
  it("renders file references with the composer's pill face", () => {
    const markup = renderToStaticMarkup(
      createElement(UserMessageContent, {
        text: "fixtures [folder:/tmp/fixtures]",
      })
    );

    // A reference keeps the same face it had while being typed; the target it
    // used to expose as an href now lives on the pill's tooltip.
    expect(markup).toContain('title="/tmp/fixtures"');
    expect(markup).toContain('role="link"');
    expect(markup).toContain("fixtures");
    // A pill, not an anchor — but it still carries a link's hover affordance.
    expect(markup).not.toContain("<a ");
    expect(markup).toContain("group-hover:underline");
  });

  it("renders an ordinary link as link text with no icon", () => {
    const markup = renderToStaticMarkup(
      createElement(UserMessageContent, {
        text: "see docs [link:https://docs.example/guide]",
      })
    );

    // Blue link text that underlines on hover — not a file-like chip.
    expect(markup).toContain('role="link"');
    expect(markup).toContain("group-hover:underline");
    expect(markup).not.toContain('data-icon="link"');
  });

  it("gives a reference pill an icon slot and an ordinary link none", () => {
    const render = (text: string) =>
      renderToStaticMarkup(createElement(UserMessageContent, { text }));
    // Only BasePill's icon slot is centred this way. A branch reference is
    // used because its glyph is a Hugeicon: the GitHub glyph is an SVG asset
    // import, which is not transformed into a component under test.
    const iconSlot = "justify-content:center";

    expect(render("main [branch:main]")).toContain(iconSlot);
    expect(render("see docs [link:https://docs.example/guide]")).not.toContain(
      iconSlot
    );
  });

  it("renders non-web references as pills carrying their target", () => {
    const markup = renderToStaticMarkup(
      createElement(UserMessageContent, { text: "main [branch:main]" })
    );

    expect(markup).toContain('title="main"');
    expect(markup).toContain('role="link"');
    expect(markup).not.toContain("<a ");
  });

  it("renders an embedded PR reference as its real GitHub link", () => {
    const url = "https://github.com/org2AI/ORG2/pull/606";
    const encoded = btoa(
      encodeURIComponent(JSON.stringify({ prUrl: url, prNumber: 606 }))
    );
    const markup = renderToStaticMarkup(
      createElement(UserMessageContent, {
        text: `ORG2#606 [pr:pr://606::${encoded}]`,
      })
    );

    // The embedded payload still resolves to the real GitHub target. A web
    // reference shows the pull-request hover card instead of a tooltip, so the
    // resolved address rides on the accessible name.
    expect(markup).toContain(`aria-label="ORG2#606 (${url})"`);
    expect(markup).not.toContain('title="');
  });

  it("renders an unsafe serialized reference as plain text", () => {
    const markup = renderToStaticMarkup(
      createElement(UserMessageContent, {
        text: "bad [link:javascript:alert(1)]",
      })
    );

    expect(markup).toContain(">bad</span>");
    expect(markup).not.toContain("javascript:alert(1)");
  });
});

describe("Canvas Design component pills", () => {
  it("decodes the versioned preview context for sent-message rendering", () => {
    const jsonText = JSON.stringify({
      schemaVersion: 1,
      origin: "canvas-design",
      previewHtml: "<div>Stat</div>",
    });
    const encoded = btoa(encodeURIComponent(jsonText));

    expect(
      parseUserMessage(
        `Stat [dom-component:paste://canvas-design/event-a/1::${encoded}]\n字体变大一些`
      )
    ).toEqual([
      {
        kind: "pill",
        displayName: "Stat",
        pillType: "dom-component",
        path: "paste://canvas-design/event-a/1",
        terminalText: jsonText,
      },
      { kind: "text", text: "\n字体变大一些" },
    ]);
  });
});

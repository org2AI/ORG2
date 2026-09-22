// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { convertClipboardHtml, htmlToMarkdown } from "../htmlToMarkdown";

describe("htmlToMarkdown — inline", () => {
  it("renders links as markdown", () => {
    expect(
      htmlToMarkdown('<p>see <a href="https://a.test/x">the doc</a></p>')
    ).toBe("see [the doc](https://a.test/x)");
  });

  it("emits a bare url when the label is the url", () => {
    expect(
      htmlToMarkdown('<a href="https://a.test/x">https://a.test/x</a>')
    ).toBe("https://a.test/x");
  });

  it("keeps the words of in-page and javascript links without the target", () => {
    expect(htmlToMarkdown('<a href="#section">Jump</a>')).toBe("Jump");
    expect(htmlToMarkdown('<a href="javascript:doIt()">Run</a>')).toBe("Run");
  });

  it("angle-wraps targets containing spaces or parens", () => {
    expect(htmlToMarkdown('<a href="https://a.test/a b">L</a>')).toBe(
      "[L](<https://a.test/a b>)"
    );
  });

  it("renders emphasis, strong, and strikethrough", () => {
    expect(
      htmlToMarkdown("<p><b>bold</b> <i>italic</i> <del>gone</del></p>")
    ).toBe("**bold** *italic* ~~gone~~");
  });

  it("moves surrounding spaces outside emphasis markers", () => {
    expect(htmlToMarkdown("<p>a<b> bold </b>b</p>")).toBe("a **bold** b");
  });

  it("renders inline code and lengthens the fence when needed", () => {
    expect(htmlToMarkdown("<p>run <code>pnpm test</code></p>")).toBe(
      "run `pnpm test`"
    );
    expect(htmlToMarkdown("<p><code>a ` b</code></p>")).toBe("``a ` b``");
  });

  it("keeps images that carry an alt and drops decorative ones", () => {
    expect(
      htmlToMarkdown('<p><img src="https://a.test/s.png" alt="chart"></p>')
    ).toBe("![chart](https://a.test/s.png)");
    expect(
      htmlToMarkdown('<p>x<img src="https://a.test/i.png" alt="">y</p>')
    ).toBe("xy");
  });

  it("drops inline base64 image payloads but keeps the alt text", () => {
    expect(
      htmlToMarkdown('<p><img src="data:image/png;base64,AAAA" alt="shot"></p>')
    ).toBe("shot");
  });

  it("resolves relative targets against a base href", () => {
    expect(
      htmlToMarkdown(
        '<base href="https://d.test/guide/install"><a href="../config">cfg</a>'
      )
    ).toBe("[cfg](https://d.test/config)");
  });

  it("leaves in-page anchors unresolved even with a base href", () => {
    expect(
      htmlToMarkdown('<base href="https://d.test/p"><a href="#s">Jump</a>')
    ).toBe("Jump");
  });

  it("separates adjacent chips that form their own box", () => {
    // WebKit writes the computed style onto pasteboard markup, so an
    // inline-flex/inline-block run is a visually separate chip, not a word.
    expect(
      htmlToMarkdown(
        '<p><span style="display: inline-flex">bug</span>' +
          '<span style="display: inline-flex">dev-tooling</span></p>'
      )
    ).toBe("bug dev-tooling");
    expect(
      htmlToMarkdown("<p><button>one</button><button>two</button></p>")
    ).toBe("one two");
  });

  it("leaves ordinary inline spans unseparated", () => {
    expect(htmlToMarkdown("<p><span>half</span><span>way</span></p>")).toBe(
      "halfway"
    );
  });

  it("collapses whitespace runs and non-breaking spaces", () => {
    expect(htmlToMarkdown("<p>a  \n  b\u00A0c</p>")).toBe("a b c");
  });
});

describe("htmlToMarkdown — blocks", () => {
  it("renders headings", () => {
    expect(htmlToMarkdown("<h1>One</h1><h3>Three</h3>")).toBe(
      "# One\n\n### Three"
    );
  });

  it("separates paragraphs with a blank line", () => {
    expect(htmlToMarkdown("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
  });

  it("renders unordered and ordered lists", () => {
    expect(htmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe("- a\n- b");
    expect(htmlToMarkdown('<ol start="3"><li>a</li><li>b</li></ol>')).toBe(
      "3. a\n4. b"
    );
  });

  it("indents nested lists under their parent item", () => {
    expect(
      htmlToMarkdown("<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul>")
    ).toBe("- a\n  - a1\n- b");
  });

  it("finds list items through a wrapper element", () => {
    expect(htmlToMarkdown("<ul><div><li>a</li><li>b</li></div></ul>")).toBe(
      "- a\n- b"
    );
  });

  it("skips contentless list rows instead of emitting a bare bullet", () => {
    expect(htmlToMarkdown("<ul><li></li><li>real</li></ul>")).toBe("- real");
  });

  it("numbers an ordered list by the rows it keeps", () => {
    expect(htmlToMarkdown("<ol><li></li><li>a</li><li>b</li></ol>")).toBe(
      "1. a\n2. b"
    );
  });

  it("drops heading markers inside a list item", () => {
    // List UIs (GitHub's PR rows among them) mark each row title up as a
    // heading; "- ### Title" is noise when the bullet already structures it.
    expect(
      htmlToMarkdown(
        '<ul><li><h3><a href="https://a.test/1">Title</a></h3></li></ul>'
      )
    ).toBe("- [Title](https://a.test/1)");
  });

  it("keeps heading markers outside a list item", () => {
    expect(htmlToMarkdown("<div><h3>Title</h3></div>")).toBe("### Title");
  });

  it("renders task-list items", () => {
    expect(
      htmlToMarkdown(
        '<ul><li><input type="checkbox" checked>done</li>' +
          '<li><input type="checkbox">todo</li></ul>'
      )
    ).toBe("- [x] done\n- [ ] todo");
  });

  it("renders fenced code with the language from the class", () => {
    expect(
      htmlToMarkdown('<pre><code class="language-ts">const a = 1;</code></pre>')
    ).toBe("```ts\nconst a = 1;\n```");
  });

  it("preserves whitespace inside pre and lengthens a colliding fence", () => {
    expect(htmlToMarkdown("<pre><code>a\n  b</code></pre>")).toBe(
      "```\na\n  b\n```"
    );
    expect(htmlToMarkdown("<pre><code>```\nx\n```</code></pre>")).toBe(
      "````\n```\nx\n```\n````"
    );
  });

  it("renders blockquotes, including nested blocks", () => {
    expect(htmlToMarkdown("<blockquote><p>a</p><p>b</p></blockquote>")).toBe(
      "> a\n>\n> b"
    );
  });

  it("renders a table, promoting the first row to the header", () => {
    expect(
      htmlToMarkdown(
        "<table><tr><th>h1</th><th>h2</th></tr>" +
          "<tr><td>a</td><td>b</td></tr></table>"
      )
    ).toBe("| h1 | h2 |\n| --- | --- |\n| a | b |");
  });

  it("escapes pipes inside table cells", () => {
    expect(
      htmlToMarkdown("<table><tr><td>a|b</td><td>c</td></tr></table>")
    ).toBe("| a\\|b | c |\n| --- | --- |");
  });

  it("escapes backslashes before pipes in table cells", () => {
    // Escaping only "|" turned a literal "\\|" into "\\\\|": an escaped
    // backslash followed by a column break, splitting the cell.
    expect(
      htmlToMarkdown("<table><tr><td>a\\|b</td><td>c</td></tr></table>")
    ).toBe("| a\\\\\\|b | c |\n| --- | --- |");
  });

  it("pads short rows to the widest row", () => {
    expect(
      htmlToMarkdown(
        "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>"
      )
    ).toBe("| a | b |\n| --- | --- |\n| c |  |");
  });

  it("stacks generic container rows as lines, not paragraphs", () => {
    expect(htmlToMarkdown("<div>row one</div><div>row two</div>")).toBe(
      "row one\nrow two"
    );
  });

  it("keeps the blank line between paragraphs inside containers", () => {
    expect(htmlToMarkdown("<div><p>a</p></div><div><p>b</p></div>")).toBe(
      "a\n\nb"
    );
  });

  it("renders br as a line break inside a paragraph", () => {
    expect(htmlToMarkdown("<p>a<br>b</p>")).toBe("a\nb");
  });

  it("renders hr", () => {
    expect(htmlToMarkdown("<p>a</p><hr><p>b</p>")).toBe("a\n\n---\n\nb");
  });
});

describe("htmlToMarkdown — resilience", () => {
  it("drops script, style, and head content", () => {
    expect(
      htmlToMarkdown(
        "<style>p{color:red}</style><script>alert(1)</script><p>kept</p>"
      )
    ).toBe("kept");
  });

  it("never runs markup from the clipboard while converting it", () => {
    const probe = window as unknown as { __pasteProbe?: number };
    delete probe.__pasteProbe;
    const out = htmlToMarkdown(
      '<p>kept<img src="x" onerror="window.__pasteProbe = 1">' +
        '<svg onload="window.__pasteProbe = 2"></svg></p>' +
        '<iframe srcdoc="<script>parent.__pasteProbe = 3</script>"></iframe>'
    );
    expect(out.startsWith("kept")).toBe(true);
    expect(out).not.toMatch(/onerror|onload|__pasteProbe|script/i);
    expect(probe.__pasteProbe).toBeUndefined();
  });

  it("keeps the text of custom elements through sanitizing", () => {
    // GitHub's list rows are built from custom elements; their words must
    // survive even though the tags themselves are dropped.
    expect(
      htmlToMarkdown(
        '<p>#1846 opened <relative-time datetime="x">6 hours ago</relative-time></p>'
      )
    ).toBe("#1846 opened 6 hours ago");
  });

  it("drops markup-hidden elements", () => {
    expect(
      htmlToMarkdown('<p hidden>no</p><p style="display:none">no</p><p>yes</p>')
    ).toBe("yes");
  });

  it("keeps the text of unknown elements rather than dropping it", () => {
    expect(htmlToMarkdown("<custom-el>content</custom-el>")).toBe("content");
  });

  it("returns an empty string for empty or oversized payloads", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown(`<p>${"x".repeat(1_000_001)}</p>`)).toBe("");
  });

  it("collapses runs of blank lines", () => {
    expect(
      htmlToMarkdown("<div><p>a</p><div></div><div></div><p>b</p></div>")
    ).toBe("a\n\nb");
  });

  it("does not stack-overflow on deeply nested markup", () => {
    const depth = 500;
    const html = `${"<div>".repeat(depth)}deep${"</div>".repeat(depth)}`;
    expect(htmlToMarkdown(html)).toBe("deep");
  });
});

describe("convertClipboardHtml", () => {
  it("keeps the plain flavor when there is no html", () => {
    expect(convertClipboardHtml("", "plain text")).toEqual({ kind: "plain" });
  });

  it("keeps the plain flavor when conversion adds nothing", () => {
    expect(
      convertClipboardHtml("<span>plain text</span>", "plain text")
    ).toEqual({ kind: "plain" });
  });

  it("returns markdown when the html carries structure", () => {
    expect(
      convertClipboardHtml('<a href="https://a.test/x">doc</a>', "doc")
    ).toEqual({ kind: "markdown", text: "[doc](https://a.test/x)" });
  });

  it("reports stripped when conversion loses most of the content", () => {
    // Everything meaningful sits in a skipped element, so the walk keeps only a
    // fraction of what the plain flavor holds.
    const html = `<p>keep</p><svg>${"dropped text ".repeat(40)}</svg>`;
    const plain = `keep ${"dropped text ".repeat(40)}`;
    expect(convertClipboardHtml(html, plain)).toEqual({ kind: "stripped" });
  });

  it("reports stripped when the markup yields nothing but text was copied", () => {
    // WebKit's paste sanitizer empties the rows of a custom-element list,
    // leaving the <ul>/<li> skeleton and no content at all.
    const gutted =
      '<ul role="list"><li aria-label="a title"></li>' +
      '<li aria-label="another"><div><br></div></li></ul>';
    expect(convertClipboardHtml(gutted, "a title\nanother")).toEqual({
      kind: "stripped",
    });
  });

  it("keeps the plain flavor when empty markup matches an empty clipboard", () => {
    expect(convertClipboardHtml("<div></div>", "   ")).toEqual({
      kind: "plain",
    });
  });

  it("uses the conversion when the clipboard has no plain flavor", () => {
    expect(convertClipboardHtml("<ul><li>a</li></ul>", "")).toEqual({
      kind: "markdown",
      text: "- a",
    });
  });

  it("converts a GitHub pull-request list into a markdown list", () => {
    // Shaped like the real list DOM: an <li> wrapping nested layout divs, an
    // aria-hidden state icon, and a decorative avatar.
    const row = (number: string, title: string): string =>
      [
        '<li class="ListItem-module__listItem">',
        '<div class="ListItem-module__container">',
        `<div class="TitleArea"><svg aria-hidden="true"><path d="M1.5 3"></path></svg>`,
        `<a href="https://github.com/org2AI/ORG2/pull/${number}">${title}</a></div>`,
        `<div class="Description-module__container"><span>#${number}</span> \u00B7 `,
        '<a href="https://github.com/Harry19081">Harry19081</a>',
        " opened 9 hours ago</div></div>",
        '<div class="Badges"><img src="https://avatars.test/u/1" alt=""></div>',
        "</li>",
      ].join("");

    const html = `<ul role="list">${row(
      "1845",
      "fix(chat): remove duplicate start-page update action"
    )}${row("1844", "feat(settings): add dev-only update mocks")}</ul>`;

    expect(htmlToMarkdown(html)).toBe(
      [
        "- [fix(chat): remove duplicate start-page update action](https://github.com/org2AI/ORG2/pull/1845)",
        "  #1845 \u00B7 [Harry19081](https://github.com/Harry19081) opened 9 hours ago",
        "- [feat(settings): add dev-only update mocks](https://github.com/org2AI/ORG2/pull/1844)",
        "  #1844 \u00B7 [Harry19081](https://github.com/Harry19081) opened 9 hours ago",
      ].join("\n")
    );
  });
});

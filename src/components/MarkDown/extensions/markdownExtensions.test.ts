// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import Markdown from "..";
import {
  registerMarkdownExtensions,
  resetMarkdownExtensions,
} from "./registry";

/**
 * The renderer is tier-1 and cannot import ChatPanel, Org2Cloud, CodeMirror or
 * the scaffold overlay. Each of those owns an extension it registers here.
 *
 * Two properties matter and are pinned below: with nothing registered every
 * block still renders its content (a Markdown block must never blank or throw
 * because a tier did not register), and a registered implementation actually
 * takes over.
 */
const render = (
  props: Parameters<typeof Markdown>[0] extends infer P ? P : never
): string => renderToStaticMarkup(createElement(Markdown, props));

afterEach(() => {
  resetMarkdownExtensions();
});

describe("markdown extension slots — plain defaults", () => {
  it("renders a fenced code block without a registered chat code block", () => {
    const markup = render({
      textContent: "```ts\nconst answer = 42;\n```",
      useChatCodeBlock: true,
    });

    expect(markup).toContain("const answer = 42;");
    expect(markup).toContain("code-block-wrapper");
  });

  it("renders a canvas fence as ordinary code without a canvas card", () => {
    const markup = render({
      textContent: "```canvas-url\nhttps://x.test\n```",
    });

    expect(markup).toContain("https://x.test");
  });

  it("renders an unrecognized reference href as a plain link", () => {
    const markup = render({ textContent: "[ref](https://example.test/a)" });

    expect(markup).toContain("https://example.test/a");
    expect(markup).toContain("<a");
  });

  it("leaves prose intact when no attachment projector is registered", () => {
    const markup = render({
      textContent: "before orgii://cloud/session/ref?v=1 after",
      sessionReferencesAsCards: true,
    });

    expect(markup).toContain("before");
    expect(markup).toContain("after");
  });

  it("still renders paragraphs with an empty registry", () => {
    expect(render({ textContent: "plain **text**" })).toContain("plain");
  });
});

describe("markdown extension slots — registered implementations", () => {
  it("routes chat fences to the registered code block", () => {
    registerMarkdownExtensions({
      ChatCodeBlock: ({ code }) =>
        createElement("pre", { "data-slot": "chat-code" }, code),
    });

    const markup = render({
      textContent: "```ts\nconst answer = 42;\n```",
      useChatCodeBlock: true,
    });

    expect(markup).toContain('data-slot="chat-code"');
    expect(markup).toContain("const answer = 42;");
  });

  it("routes canvas fences to the registered inline card", () => {
    registerMarkdownExtensions({
      CanvasInlineCard: ({ mode }) =>
        createElement("div", { "data-slot": "canvas", "data-mode": mode }),
    });

    const markup = render({
      textContent: "```canvas-url\nhttps://x.test\n```",
    });

    expect(markup).toContain('data-slot="canvas"');
    expect(markup).toContain('data-mode="url"');
  });

  it("lets a registered reference renderer take over a link href", () => {
    registerMarkdownExtensions({
      ownsReferenceHref: (href) => href.startsWith("orgii://"),
      renderReferenceLink: (href, children) =>
        href.startsWith("orgii://")
          ? createElement("span", { "data-slot": "reference" }, children)
          : null,
    });

    const markup = render({ textContent: "[label](orgii://cloud/thing)" });

    expect(markup).toContain('data-slot="reference"');
    expect(markup).toContain("label");
  });

  it("falls through to the plain link when the renderer declines", () => {
    registerMarkdownExtensions({
      renderReferenceLink: () => null,
    });

    const markup = render({ textContent: "[label](https://example.test/a)" });

    expect(markup).toContain("<a");
    expect(markup).toContain("https://example.test/a");
  });

  it("projects and renders registered session attachments", () => {
    registerMarkdownExtensions({
      sessionAttachments: {
        project: (source) => ({
          text: source.replace("[[ref]]", "").trim(),
          attachments: source.includes("[[ref]]") ? ["ref-1"] : [],
          referenceOnly: false,
        }),
        render: (attachments) =>
          createElement(
            "div",
            { "data-slot": "attachments" },
            attachments.length
          ),
      },
    });

    const markup = render({
      textContent: "keep this [[ref]]",
      sessionReferencesAsCards: true,
    });

    expect(markup).toContain("keep this");
    expect(markup).not.toContain("[[ref]]");
    expect(markup).toContain('data-slot="attachments"');
  });

  it("appends registered remark plugins to the base GFM set", () => {
    const shout = () => (tree: { children?: { value?: string }[] }) => {
      for (const node of tree.children ?? []) {
        const paragraph = node as { children?: { value?: string }[] };
        for (const child of paragraph.children ?? []) {
          if (typeof child.value === "string")
            child.value = child.value.toUpperCase();
        }
      }
    };
    registerMarkdownExtensions({ remarkPlugins: [shout] });

    expect(render({ textContent: "quiet" })).toContain("QUIET");
  });

  it("merges registrations from separate tiers", () => {
    registerMarkdownExtensions({ ownsReferenceHref: () => true });
    registerMarkdownExtensions({
      CanvasInlineCard: () => createElement("div", { "data-slot": "canvas" }),
    });

    const markup = render({ textContent: "```canvas-url\nx\n```" });
    expect(markup).toContain('data-slot="canvas"');
  });
});

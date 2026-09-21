/**
 * Pins the knobs that distinguish the five header-only blocks, because those
 * differences are what a "they're all the same, merge them" refactor loses:
 * only TitleOnlyBlock/SkillBlock fade in, only the tool blocks decorate and
 * truncate the subtitle, and GlobBlock alone prefixes a file-type icon.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import HeaderOnlyBlock, { type HeaderOnlyBlockProps } from "./HeaderOnlyBlock";

vi.mock("../useBlockLocate", () => ({
  useBlockHeader: () => ({
    isHeaderHovered: false,
    handleHeaderMouseEnter: () => undefined,
    handleHeaderMouseLeave: () => undefined,
    handleLocate: undefined,
  }),
}));

const render = (props: HeaderOnlyBlockProps): string =>
  renderToStaticMarkup(createElement(HeaderOnlyBlock, props));

const base: HeaderOnlyBlockProps = { icon: null, title: "Searched files" };

describe("HeaderOnlyBlock", () => {
  it("fades in only when asked", () => {
    expect(render({ ...base, animate: true })).toContain("animate-fade-in");
    expect(render(base)).not.toContain("animate-fade-in");
  });

  it("renders no subtitle slot for an empty subtitle", () => {
    const withSubtitle = render({ ...base, subtitle: "src/index.ts" });
    expect(withSubtitle).toContain("src/index.ts");
    expect(render({ ...base, subtitle: "" })).not.toContain("truncate");
    expect(render({ ...base, subtitle: undefined })).not.toContain("truncate");
  });

  it("decorates the subtitle the way the tool blocks do", () => {
    const html = render({
      ...base,
      subtitle: "src/**/*.ts",
      subtitleTitle: "src/**/*.ts",
      subtitleClassName: "text-text-1",
      truncateSubtitle: true,
    });
    // Tooltip, tone and the truncating wrapper all survive.
    expect(html).toContain('title="src/**/*.ts"');
    expect(html).toContain("text-text-1");
    expect(html).toMatch(/<span class="min-w-0 truncate">src\/\*\*\/\*\.ts/);
  });

  it("puts the subtitle prefix before the subtitle text", () => {
    const html = render({
      ...base,
      subtitle: "a.ts",
      subtitlePrefix: createElement("i", { "data-testid": "file-icon" }),
      truncateSubtitle: true,
    });
    expect(html.indexOf("file-icon")).toBeLessThan(html.indexOf("a.ts"));
  });

  it("passes container attributes through", () => {
    const html = render({
      ...base,
      containerProps: {
        "data-tool-call-name": "skill",
      } as HeaderOnlyBlockProps["containerProps"],
    });
    expect(html).toContain('data-tool-call-name="skill"');
  });
});

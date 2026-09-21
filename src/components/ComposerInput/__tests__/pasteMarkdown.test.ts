// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readPillText } from "@src/config/pillTokens";

import { createPasteHandler } from "../pasteHandlers";
import type { ComposerPillAttrs } from "../types";

const readUnsanitizedClipboardHtml = vi.hoisted(() => vi.fn());
vi.mock("../nativeClipboardHtml", () => ({ readUnsanitizedClipboardHtml }));

interface ClipboardFlavors {
  plain?: string;
  html?: string;
  fragment?: string;
}

function pasteEvent(flavors: ClipboardFlavors): {
  event: ClipboardEvent;
  prevented: () => boolean;
} {
  let defaultPrevented = false;
  const data: Record<string, string> = {
    "text/plain": flavors.plain ?? "",
    "text/html": flavors.html ?? "",
    "application/x-orgii-composer-fragment": flavors.fragment ?? "",
  };
  const event = {
    clipboardData: {
      items: { length: 0 } as unknown as DataTransferItemList,
      getData: (type: string) => data[type] ?? "",
      types: Object.keys(data).filter((type) => data[type]),
    } as unknown as DataTransfer,
    preventDefault: () => {
      defaultPrevented = true;
    },
  } as unknown as ClipboardEvent;
  return { event, prevented: () => defaultPrevented };
}

/** Pages "open in the in-app browser" for a test, keyed by URL. */
function browserSessions(
  pages: Record<string, string>
): (url: string) => ComposerPillAttrs | null {
  return (url) =>
    url in pages
      ? {
          filePath: `browser://${pages[url]}/1`,
          fileName: "Open Page",
          isFolder: false,
          iconType: "browser",
          lineStart: null,
          lineEnd: null,
        }
      : null;
}

function createContext(
  resolveBrowserPill: (url: string) => ComposerPillAttrs | null = () => null
) {
  const inserted: string[] = [];
  const pills: ComposerPillAttrs[] = [];
  const deferred: Promise<void>[] = [];
  return {
    inserted,
    pills,
    /** Await every async recovery the handler kicked off. */
    settle: () => Promise.all(deferred),
    ctx: {
      runDeferred: (work: () => Promise<void>) => {
        deferred.push(work());
      },
      insertPill: (attrs: ComposerPillAttrs) => {
        pills.push(attrs);
      },
      insertTextAtCaret: (text: string) => {
        inserted.push(text);
      },
      getOnImagePaste: () => undefined,
      getInstalledSkills: () => [],
      resolveBrowserPill,
    },
  };
}

describe("ComposerInput paste — markdown conversion", () => {
  beforeEach(() => {
    window.__orgiiLastTerminalCopy = undefined;
    readUnsanitizedClipboardHtml.mockReset();
    readUnsanitizedClipboardHtml.mockResolvedValue(null);
  });

  it("inserts markdown when the clipboard carries a rich flavor", () => {
    const { ctx, inserted, pills } = createContext();
    const { event, prevented } = pasteEvent({
      plain: "see the doc",
      html: '<p>see <a href="https://a.test/x">the doc</a></p>',
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(prevented()).toBe(true);
    // The link's words stay as text; the target becomes a pill beside them.
    expect(inserted.join("")).toBe("see the doc  ");
    expect(pills).toHaveLength(1);
    expect(pills[0]).toMatchObject({
      filePath: "https://a.test/x",
      iconType: "link",
    });
  });

  it("inserts the plain flavor when there is no html to convert", () => {
    const { ctx, inserted } = createContext();
    const { event } = pasteEvent({ plain: "just words" });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(inserted).toEqual(["just words"]);
  });

  it("inserts the plain flavor when the html adds no structure", () => {
    const { ctx, inserted } = createContext();
    const { event } = pasteEvent({
      plain: "just words",
      html: '<span style="color:red">just words</span>',
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(inserted).toEqual(["just words"]);
  });

  it("still converts a copied link into a pill rather than a markdown link", () => {
    const { ctx, inserted, pills } = createContext();
    const { event } = pasteEvent({
      plain: "https://a.test/docs/page",
      html: '<a href="https://a.test/docs/page">Page title</a>',
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(pills).toHaveLength(1);
    expect(pills[0].filePath).toBe("https://a.test/docs/page");
    expect(inserted).toEqual([" "]);
  });

  it("still replays a composer fragment instead of converting its html", () => {
    const { ctx, inserted, pills } = createContext();
    const { event } = pasteEvent({
      plain: "copied",
      html: "<p><b>copied</b></p>",
      fragment: JSON.stringify([{ kind: "text", text: "copied" }]),
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(inserted).toEqual(["copied"]);
    expect(pills).toHaveLength(0);
  });

  it("collapses a large rich paste into a markdown paste pill", () => {
    const { ctx, inserted, pills } = createContext();
    const rows = Array.from(
      { length: 90 },
      (_unused, index) =>
        `<li><a href="https://a.test/pull/${index}">pull ${index}</a></li>`
    ).join("");
    const { event } = pasteEvent({
      plain: Array.from({ length: 90 }, (_u, i) => `pull ${i}`).join("\n"),
      html: `<ul>${rows}</ul>`,
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(inserted).toHaveLength(0);
    expect(pills).toHaveLength(1);
    expect(pills[0].fileName).toBe("pasted.md");
    expect(readPillText(pills[0].filePath!)).toContain(
      "- [pull 0](https://a.test/pull/0)"
    );
  });

  it("keeps a link-dense list inline when the copied text was small", () => {
    // 50 rows: ~1,100 plain chars over 50 lines — comfortably inside both
    // gates — but past 4,000 once every row carries its URL. The user copied a
    // short list and should still see a short list.
    const { ctx, inserted, pills } = createContext();
    const rows = Array.from({ length: 50 }, (_unused, index) => ({
      title: `pull request number ${index}`,
      href: `https://github.com/org2AI/ORG2/pulls?q=is%3Apr+state%3Aopen+author%3Auser${index}`,
    }));
    const { event } = pasteEvent({
      plain: rows.map((row) => row.title).join("\n"),
      html: `<ul>${rows
        .map((row) => `<li><a href="${row.href}">${row.title}</a></li>`)
        .join("")}</ul>`,
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    // Inline, not collapsed: no `paste` pill, one link pill per row.
    expect(pills.some((pill) => pill.iconType === "paste")).toBe(false);
    expect(pills).toHaveLength(50);
    expect(inserted.join("")).toContain("pull request number 0");
  });

  it("keeps the txt pill name for a large plain paste", () => {
    const { ctx, pills } = createContext();
    const { event } = pasteEvent({ plain: "x".repeat(4_000) });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(pills).toHaveLength(1);
    expect(pills[0].fileName).toBe("pasted.txt");
  });

  it("recovers content WebKit stripped by reading the pasteboard natively", async () => {
    // What the paste event delivers: the list skeleton, rows emptied.
    const gutted =
      '<ul role="list"><li aria-label="feat: a title"></li>' +
      '<li aria-label="fix: another"></li></ul>';
    // What is actually on the pasteboard.
    readUnsanitizedClipboardHtml.mockResolvedValue(
      '<ul><li><a href="https://a.test/1">feat: a title</a></li>' +
        '<li><a href="https://a.test/2">fix: another</a></li></ul>'
    );

    const { ctx, inserted, pills, settle } = createContext();
    const { event, prevented } = pasteEvent({
      plain: "feat: a title\nfix: another",
      html: gutted,
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(prevented()).toBe(true);
    expect(inserted).toHaveLength(0); // nothing inserted synchronously
    await settle();

    expect(readUnsanitizedClipboardHtml).toHaveBeenCalledTimes(1);
    // No gap is inserted before a line break — only before following prose.
    expect(inserted.join("")).toBe("- feat: a title \n- fix: another  ");
    expect(pills.map((pill) => pill.filePath)).toEqual([
      "https://a.test/1",
      "https://a.test/2",
    ]);
  });

  it("falls back to the plain flavor when the native read yields nothing", async () => {
    readUnsanitizedClipboardHtml.mockResolvedValue(null);
    const { ctx, inserted, settle } = createContext();
    const { event } = pasteEvent({
      plain: "a title\nanother",
      html: '<ul role="list"><li aria-label="a title"></li></ul>',
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    await settle();
    expect(inserted).toEqual(["a title\nanother"]);
  });

  it("does not pay for a native read when the html converts cleanly", async () => {
    const { ctx, settle } = createContext();
    const { event } = pasteEvent({
      plain: "the doc",
      html: '<a href="https://a.test/x">the doc</a>',
    });

    createPasteHandler(ctx)(event);
    await settle();
    expect(readUnsanitizedClipboardHtml).not.toHaveBeenCalled();
  });

  it("labels a pill with one-word link text instead of its address", () => {
    const { ctx, inserted, pills } = createContext();
    const { event } = pasteEvent({
      plain: "opened by sudomaggie today",
      html:
        '<p>opened by <a href="https://github.com/org2AI/ORG2/pulls?q=is%3Apr+author%3Asudomaggie">' +
        "sudomaggie</a> today</p>",
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(pills).toHaveLength(1);
    expect(pills[0].fileName).toBe("sudomaggie");
    // The words live in the pill, so they must not also appear as text.
    expect(inserted.join("")).toBe("opened by  today");
  });

  it("keeps multi-word link text as prose beside the pill", () => {
    const { ctx, inserted, pills } = createContext();
    const { event } = pasteEvent({
      plain: "fix(security): upgrade rustls",
      html:
        '<a href="https://github.com/org2AI/ORG2/pull/1808">' +
        "fix(security): upgrade rustls</a>",
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(inserted.join("")).toBe("fix(security): upgrade rustls  ");
    // The pill grammar cannot hold spaces, so it falls back to the reference.
    expect(pills[0]).toMatchObject({
      fileName: "org2AI/ORG2#1808",
      iconType: "pr",
    });
  });

  it("does not label a pill with a bare url", () => {
    const { ctx, pills } = createContext();
    const { event } = pasteEvent({
      plain: "see it",
      html: '<p>see <a href="https://a.test/deep/path">https://a.test/deep/path</a></p>',
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    // The address as pasted — scheme included — not a shortened host/path.
    expect(pills[0].fileName).toBe("https://a.test/deep/path");
  });

  it("keeps an ordinary pasted url as a link, not a browser reference", () => {
    const { ctx, pills } = createContext(
      browserSessions({ "https://open.test/page": "s1" })
    );
    const { event } = pasteEvent({ plain: "https://elsewhere.test/page" });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(pills).toHaveLength(1);
    expect(pills[0]).toMatchObject({
      filePath: "https://elsewhere.test/page",
      iconType: "link",
    });
  });

  it("turns a pasted url of an open in-app browser page into a browser pill", () => {
    const { ctx, inserted, pills } = createContext(
      browserSessions({ "https://open.test/page": "s1" })
    );
    const { event } = pasteEvent({ plain: "https://open.test/page" });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(pills).toEqual([
      expect.objectContaining({
        filePath: "browser://s1/1",
        iconType: "browser",
      }),
    ]);
    expect(inserted).toEqual([" "]);
  });

  it("resolves links inside a rich paste against open browser pages too", () => {
    const { ctx, pills } = createContext(
      browserSessions({ "https://open.test/page": "s1" })
    );
    const { event } = pasteEvent({
      plain: "see open page and other",
      html:
        '<p>see <a href="https://open.test/page">open page</a> and ' +
        '<a href="https://elsewhere.test/x">other</a></p>',
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(pills.map((pill) => pill.iconType)).toEqual(["browser", "link"]);
  });

  it("prefers the GitHub reference over an open browser page", () => {
    const url = "https://github.com/org2AI/ORG2/pull/1808";
    const { ctx, pills } = createContext(browserSessions({ [url]: "s1" }));
    const { event } = pasteEvent({
      plain: "fix(security): upgrade rustls",
      html: `<a href="${url}">fix(security): upgrade rustls</a>`,
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(pills[0]).toMatchObject({ iconType: "pr" });
  });

  it("links a url inside plain pasted prose", () => {
    const url = "https://wiportal.wiwide.com/portal?res=notyet&auth=vw%2b5s";
    const { ctx, inserted, pills } = createContext();
    const { event } = pasteEvent({
      plain: `i pasted ${url}\n\nfor links pasted`,
    });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(pills).toEqual([
      expect.objectContaining({ filePath: url, iconType: "link" }),
    ]);
    expect(inserted.join("")).toBe("i pasted \n\nfor links pasted");
  });

  it("leaves urls inside pasted code and logs untouched", () => {
    const trace =
      "Error: boom\n    at run (http://localhost:1998/main.js:12:4)";
    const { ctx, inserted, pills } = createContext();
    const { event } = pasteEvent({ plain: trace });

    expect(createPasteHandler(ctx)(event)).toBe(true);
    expect(pills).toHaveLength(0);
    expect(inserted.join("")).toBe(trace);
  });

  it("still forwards pasted image files to the image handler", () => {
    const { ctx, inserted, pills } = createContext();
    const file = new File(["x"], "shot.png", { type: "image/png" });
    const onImagePaste = vi.fn();
    const { event, prevented } = pasteEvent({ html: "<p><b>ignored</b></p>" });
    Object.defineProperty(event.clipboardData!, "items", {
      value: [{ type: "image/png", getAsFile: () => file }],
    });

    const handler = createPasteHandler({
      ...ctx,
      getOnImagePaste: () => onImagePaste,
    });
    expect(handler(event)).toBe(true);
    expect(prevented()).toBe(true);
    expect(onImagePaste).toHaveBeenCalledWith([file]);
    expect(inserted).toHaveLength(0);
    expect(pills).toHaveLength(0);
  });
});

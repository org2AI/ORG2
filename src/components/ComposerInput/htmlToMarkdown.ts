/**
 * Clipboard HTML → Markdown for ComposerInput.
 *
 * The composer is a plain-text surface: it has no bold/italic buttons and the
 * document it produces is the literal string handed to the agent. So a rich
 * paste (a GitHub list, a docs page, a spreadsheet range) must be *flattened*,
 * not embedded — but flattening to `text/plain` throws away link targets, list
 * structure, code fences, and table shape, which are exactly the parts an agent
 * needs. This module converts the clipboard's `text/html` flavor into markdown
 * text so that structure survives as syntax the model already understands.
 *
 * Deliberately not a general-purpose HTML→Markdown library:
 *   - No markdown escaping of body text. Backslash-escaping every `*`, `_`, and
 *     `#` in pasted prose is noisier in a chat composer than the rare literal
 *     asterisk it protects.
 *   - Unknown/unsupported elements degrade to their text content rather than
 *     being dropped, so a paste can never silently lose the user's content.
 *   - Clipboard markup is untrusted: it is sanitized with DOMPurify, which
 *     parses it into an inert document and strips anything executable, before
 *     any of it is read.
 */
import DOMPurify from "dompurify";

/**
 * `<base href>` of the payload currently being converted, when it has one.
 * Module-level rather than threaded through every renderer: conversion is
 * synchronous and never reentrant, and it is set once per `htmlToMarkdown` call.
 */
let documentBaseUrl = "";

/** Beyond this, parsing/walking costs more than the paste is worth. */
const MAX_HTML_LENGTH = 1_000_000;
/** Guards against pathological nesting blowing the call stack. */
const MAX_DEPTH = 64;

/**
 * Elements whose text is markup, chrome, or a resource reference rather than
 * pasted content.
 */
const SKIPPED_TAGS = new Set([
  "AUDIO",
  "CANVAS",
  "EMBED",
  "HEAD",
  "IFRAME",
  "LINK",
  "META",
  "NOSCRIPT",
  "OBJECT",
  "SCRIPT",
  "STYLE",
  "SVG",
  "TEMPLATE",
  "TITLE",
  "VIDEO",
]);

/**
 * Elements that start their own block. Anything not listed here is treated as
 * inline and folded into the surrounding paragraph.
 */
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "UL",
]);

const HEADING_LEVELS: Record<string, number> = {
  H1: 1,
  H2: 2,
  H3: 3,
  H4: 4,
  H5: 5,
  H6: 6,
};

/**
 * Generic containers. They start a block, but unlike `<p>` they carry no claim
 * that their content is a separate paragraph — a page's row/cell wrappers are
 * mostly these. Inside a list item they join as continuation lines rather than
 * splitting one entry across blank-line-separated paragraphs.
 */
const SOFT_BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "DD",
  "DETAILS",
  "DIV",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "HEADER",
  "MAIN",
  "NAV",
  "SECTION",
  "SUMMARY",
]);

/**
 * Whether an element's own text stands as a paragraph. `<p>` and `<li>` do;
 * a layout `<div>` does not, and neither does `<body>`.
 */
function isHardContainer(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  return BLOCK_TAGS.has(tag) && !SOFT_BLOCK_TAGS.has(tag);
}

/** A rendered block plus the shape hints the joiners need. */
interface Block {
  /** Lists join to the previous block with a single newline, not a blank one. */
  isList: boolean;
  /** Came from a generic container rather than a semantic paragraph. */
  isSoft: boolean;
  text: string;
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === 1;
}

function isTextNode(node: Node): node is Text {
  return node.nodeType === 3;
}

/**
 * Hidden by markup alone. Computed styles are unavailable on an inert document,
 * and unnecessary: the clipboard payload is a *selection*, which the browser has
 * already trimmed to visible content. This only catches the leftovers.
 */
function isHidden(el: Element): boolean {
  if (el.hasAttribute("hidden")) return true;
  const style = el.getAttribute("style");
  if (!style) return false;
  return (
    /(^|;)\s*display\s*:\s*none/i.test(style) ||
    /(^|;)\s*visibility\s*:\s*hidden/i.test(style)
  );
}

/** HTML whitespace semantics: runs collapse, NBSP becomes an ordinary space. */
function collapseWhitespace(value: string): string {
  return value.replace(/\u00A0/g, " ").replace(/\s+/g, " ");
}

/** Collapse an inline run to a single line — for links, headings, table cells. */
function toSingleLine(value: string): string {
  return collapseWhitespace(value).trim();
}

function wrapInline(text: string, marker: string): string {
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match || !match[2]) return text;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

function longestRunOfBackticks(value: string): number {
  let longest = 0;
  const matches = value.match(/`+/g);
  if (matches) {
    for (const run of matches) longest = Math.max(longest, run.length);
  }
  return longest;
}

function renderInlineCode(el: Element): string {
  const raw = toSingleLine(el.textContent ?? "");
  if (!raw) return "";
  const fence = "`".repeat(longestRunOfBackticks(raw) + 1);
  const padding = raw.startsWith("`") || raw.endsWith("`") ? " " : "";
  return `${fence}${padding}${raw}${padding}${fence}`;
}

/**
 * Browsers normally absolutize hrefs when they build the clipboard's HTML
 * flavor, but not always — and a relative path is no use to an agent that has
 * no page context. Resolve against the payload's own base when it declares one.
 */
function resolveUrl(raw: string): string {
  if (!documentBaseUrl || !raw) return raw;
  try {
    return new URL(raw, documentBaseUrl).href;
  } catch {
    return raw;
  }
}

function renderAnchor(el: Element, depth: number): string {
  const rawHref = (el.getAttribute("href") ?? "").trim();
  const label =
    toSingleLine(renderInlineChildren(el, depth)) ||
    (el.getAttribute("title") ?? "").trim() ||
    (el.getAttribute("aria-label") ?? "").trim();

  // In-page anchors and `javascript:` handlers carry no destination worth
  // pasting; keep the words, drop the link. Checked before resolution, which
  // would otherwise turn "#section" into a page URL.
  if (!rawHref || rawHref.startsWith("#") || /^javascript:/i.test(rawHref)) {
    return label;
  }

  const href = resolveUrl(rawHref);
  if (!label || label === href) return href;

  const target = /[\s()]/.test(href) ? `<${href}>` : href;
  return `[${label}](${target})`;
}

function renderImage(el: Element): string {
  const src = resolveUrl((el.getAttribute("src") ?? "").trim());
  const alt = el.getAttribute("alt");
  // `alt=""` is the HTML spec's marker for a decorative image — icons, avatars,
  // and spacers. Emitting those as markdown buries the real content in noise.
  if (alt === "") return "";
  const label = toSingleLine(alt ?? "");
  if (!src || src.startsWith("data:")) return label;
  const target = /[\s()]/.test(src) ? `<${src}>` : src;
  return `![${label}](${target})`;
}

/**
 * An inline element that still forms its own box — a chip, a pill, a label
 * button. WebKit writes the computed style onto every element it puts on the
 * pasteboard, so `display` is available here and is the honest signal that two
 * adjacent runs are visually separate rather than one word.
 */
function formsOwnBox(el: Element): boolean {
  if (el.tagName.toUpperCase() === "BUTTON") return true;
  const style = el.getAttribute("style");
  const match = style?.match(/(?:^|;)\s*display\s*:\s*([a-z-]+)/i);
  if (!match) return false;
  const display = match[1].toLowerCase();
  return display !== "inline" && display !== "contents";
}

function renderInline(node: Node, depth: number): string {
  if (isTextNode(node)) return collapseWhitespace(node.data);
  if (!isElementNode(node)) return "";
  if (depth > MAX_DEPTH) return collapseWhitespace(node.textContent ?? "");

  const el = node;
  const tag = el.tagName.toUpperCase();
  if (SKIPPED_TAGS.has(tag) || isHidden(el)) return "";

  switch (tag) {
    case "BR":
      return "\n";
    case "IMG":
      return renderImage(el);
    case "A":
      return renderAnchor(el, depth + 1);
    case "STRONG":
    case "B":
      return wrapInline(renderInlineChildren(el, depth + 1), "**");
    case "EM":
    case "I":
      return wrapInline(renderInlineChildren(el, depth + 1), "*");
    case "DEL":
    case "S":
    case "STRIKE":
      return wrapInline(renderInlineChildren(el, depth + 1), "~~");
    case "CODE":
    case "KBD":
    case "SAMP":
      return renderInlineCode(el);
    case "INPUT":
      return "";
    default:
      break;
  }

  const inner = renderInlineChildren(el, depth + 1);
  // A block element reached through an inline context (a `<p>` inside a table
  // cell, say) still has to keep its neighbours apart, and so does a chip.
  return BLOCK_TAGS.has(tag) || formsOwnBox(el) ? ` ${inner} ` : inner;
}

function renderInlineChildren(el: Element, depth: number): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    out += renderInline(child, depth);
  }
  return out;
}

function renderPre(el: Element): string {
  const codeEl = el.querySelector("code");
  const source = codeEl ?? el;
  const text = (source.textContent ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/, "");
  if (!text.trim()) return "";
  const fence = "`".repeat(Math.max(3, longestRunOfBackticks(text) + 1));
  return `${fence}${detectCodeLanguage(source)}\n${text}\n${fence}`;
}

function detectCodeLanguage(el: Element): string {
  const fromData = (el.getAttribute("data-lang") ?? "").trim();
  if (fromData) return fromData;
  for (const className of Array.from(el.classList)) {
    const match = className.match(/^(?:language|lang|highlight-source)-(.+)$/i);
    if (match) return match[1].toLowerCase();
  }
  return "";
}

function renderBlockquote(el: Element, depth: number): string {
  const inner = joinBlocks(renderChildBlocks(el, depth + 1));
  if (!inner) return "";
  return inner
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/** Direct-child checkbox — a GitHub-style task list item. */
function taskListPrefix(el: Element): string {
  for (const child of Array.from(el.children)) {
    if (
      child.tagName.toUpperCase() === "INPUT" &&
      (child.getAttribute("type") ?? "").toLowerCase() === "checkbox"
    ) {
      return child.hasAttribute("checked") ? "[x] " : "[ ] ";
    }
  }
  return "";
}

/** Prefix the first line with `marker`, indenting continuations to match. */
function indentListItem(marker: string, body: string): string {
  const padding = " ".repeat(marker.length);
  return body
    .split("\n")
    .map((line, index) => {
      if (index === 0) return `${marker}${line}`;
      return line ? `${padding}${line}` : "";
    })
    .join("\n");
}

function renderList(el: Element, ordered: boolean, depth: number): string {
  const startAttr = Number.parseInt(el.getAttribute("start") ?? "", 10);
  let counter = ordered && Number.isFinite(startAttr) ? startAttr : 1;

  // Found by descent rather than direct children: React list UIs routinely put
  // a wrapper element between the <ul> and its <li>s, and reading `el.children`
  // alone would see no items at all and drop the whole list.
  const listItems = Array.from(el.querySelectorAll("li")).filter(
    (item) => item.closest("ul,ol") === el && !isHidden(item)
  );

  const items: string[] = [];
  for (const item of listItems) {
    const body = joinListItemBlocks(renderChildBlocks(item, depth + 1, true));
    const content = `${taskListPrefix(item)}${body}`;
    // An empty row (a selection that started mid-list, a spacer <li>) would
    // otherwise paste as a bare, contentless bullet.
    if (!content.trim()) continue;
    const marker = ordered ? `${counter}. ` : "- ";
    counter += 1;
    items.push(indentListItem(marker, content));
  }
  return items.join("\n");
}

function renderTable(el: Element, depth: number): string {
  const rows: string[][] = [];
  for (const tr of Array.from(el.querySelectorAll("tr"))) {
    // Skip rows belonging to a nested table; that table renders on its own.
    if (tr.closest("table") !== el || isHidden(tr)) continue;
    const cells = Array.from(tr.children).filter((cell) => {
      const tag = cell.tagName.toUpperCase();
      return tag === "TD" || tag === "TH";
    });
    if (cells.length === 0) continue;
    rows.push(
      cells.map((cell) =>
        // Backslashes first: escaping only "|" turns a literal "\|" into
        // "\\|", which markdown reads as an escaped backslash followed by a
        // column break.
        toSingleLine(renderInlineChildren(cell, depth + 1))
          .replace(/\\/g, "\\\\")
          .replace(/\|/g, "\\|")
      )
    );
  }
  if (rows.length === 0) return "";

  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const pad = (row: string[]): string[] => {
    const padded = row.slice();
    while (padded.length < width) padded.push("");
    return padded;
  };
  const toLine = (row: string[]): string => `| ${pad(row).join(" | ")} |`;

  // Markdown has no headerless table. A spreadsheet or list-shaped range almost
  // always leads with its labels, so promote the first row rather than emitting
  // an empty header band.
  const [header, ...body] = rows;
  const divider = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
  return [toLine(header), divider, ...body.map(toLine)].join("\n");
}

function renderBlockElement(
  el: Element,
  depth: number,
  inListItem: boolean
): Block | null {
  const tag = el.tagName.toUpperCase();

  if (tag === "HR") return { isList: false, isSoft: false, text: "---" };
  if (tag === "PRE") {
    const text = renderPre(el);
    return text ? { isList: false, isSoft: false, text } : null;
  }
  if (tag === "UL" || tag === "OL") {
    const text = renderList(el, tag === "OL", depth);
    return text ? { isList: true, isSoft: false, text } : null;
  }
  if (tag === "TABLE") {
    const text = renderTable(el, depth);
    return text ? { isList: false, isSoft: false, text } : null;
  }
  if (tag === "BLOCKQUOTE") {
    const text = renderBlockquote(el, depth);
    return text ? { isList: false, isSoft: false, text } : null;
  }

  const headingLevel = HEADING_LEVELS[tag];
  if (headingLevel) {
    const text = toSingleLine(renderInlineChildren(el, depth + 1));
    if (!text) return null;
    // A bullet already carries the structure a heading would: "- ### Title" is
    // noise, and list UIs (GitHub's rows among them) mark row titles up as
    // headings. Keep the words, drop the markers.
    return {
      isList: false,
      isSoft: inListItem,
      text: inListItem ? text : `${"#".repeat(headingLevel)} ${text}`,
    };
  }

  const blocks = renderChildBlocks(el, depth + 1, inListItem);
  const text = joinBlocks(blocks);
  if (!text) return null;
  // A wrapper around exactly one block is that block as far as spacing goes;
  // a wrapper around several is a container, and containers stack as lines.
  const onlyChild = blocks.length === 1 ? blocks[0] : null;
  return {
    isList: onlyChild?.isList ?? false,
    isSoft: onlyChild ? onlyChild.isSoft : SOFT_BLOCK_TAGS.has(tag),
    text,
  };
}

/**
 * Split an element's children into blocks, gathering consecutive inline runs
 * into paragraphs.
 */
function renderChildBlocks(
  el: Element,
  depth: number,
  inListItem = false
): Block[] {
  if (depth > MAX_DEPTH) {
    const text = collapseWhitespace(el.textContent ?? "").trim();
    return text ? [{ isList: false, isSoft: !isHardContainer(el), text }] : [];
  }

  const blocks: Block[] = [];
  const inlineRunIsSoft = !isHardContainer(el);
  let inlineRun = "";

  const flushInlineRun = (): void => {
    const text = inlineRun
      .split("\n")
      .map((line) => collapseWhitespace(line).trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    inlineRun = "";
    if (text) blocks.push({ isList: false, isSoft: inlineRunIsSoft, text });
  };

  for (const child of Array.from(el.childNodes)) {
    if (
      isElementNode(child) &&
      BLOCK_TAGS.has(child.tagName.toUpperCase()) &&
      !SKIPPED_TAGS.has(child.tagName.toUpperCase())
    ) {
      if (isHidden(child)) continue;
      flushInlineRun();
      const block = renderBlockElement(child, depth, inListItem);
      if (block) blocks.push(block);
      continue;
    }
    inlineRun += renderInline(child, depth);
  }
  flushInlineRun();

  return blocks;
}

function joinBlocks(blocks: Block[]): string {
  let out = "";
  blocks.forEach((block, index) => {
    if (index > 0) out += block.isSoft ? "\n" : "\n\n";
    out += block.text;
  });
  return out;
}

/**
 * Inside a list item, a nested list and a generic container both hug the line
 * they hang off — a row's metadata line belongs to its entry, not to a
 * paragraph of its own. Only real paragraph siblings get the blank line.
 */
function joinListItemBlocks(blocks: Block[]): string {
  let out = "";
  blocks.forEach((block, index) => {
    if (index > 0) out += block.isList || block.isSoft ? "\n" : "\n\n";
    out += block.text;
  });
  return out;
}

/**
 * Convert a clipboard `text/html` payload into markdown text. Returns `""` when
 * the payload is unusable (too large, unparseable, or empty of content).
 *
 * Exported for unit tests; production callers go through
 * `convertClipboardHtml`, which also decides whether the conversion is an
 * improvement over the plain-text flavor.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html.length > MAX_HTML_LENGTH) return "";

  let root: Node;
  try {
    // Clipboard markup is untrusted. DOMPurify parses it into an inert
    // document and strips anything executable before it is walked. `<base>`
    // is readmitted — it only resolves relative links here — so the whole
    // document is kept rather than just its body.
    root = DOMPurify.sanitize(html, {
      WHOLE_DOCUMENT: true,
      RETURN_DOM: true,
      ADD_TAGS: ["base"],
    });
  } catch {
    return "";
  }
  if (!isElementNode(root)) return "";
  const body = root.querySelector("body");
  if (!body) return "";

  documentBaseUrl =
    root.querySelector("base")?.getAttribute("href")?.trim() ?? "";

  return joinBlocks(renderChildBlocks(body, 0))
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Letters and digits only — the part of a paste that is *content*. Markdown
 * conversion only ever adds punctuation and URLs, so a drop in this count means
 * the walk lost something the user actually copied.
 */
function contentCharCount(value: string): number {
  return (value.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/**
 * A conversion that keeps less than this share of the plain flavor's content is
 * treated as lossy, and the plain flavor wins.
 */
const CONTENT_RETENTION_RATIO = 0.9;

/**
 * What the paste pipeline should do with a clipboard's rich flavor.
 *
 * `stripped` is the case that matters on macOS: the payload parsed, but the
 * markup carries far less text than the plain flavor does, which means content
 * was removed before we saw it rather than simply being unstructured. That is
 * WebKit's paste sanitizer at work, and it is the one situation where asking
 * the platform for the raw pasteboard bytes can do better.
 */
export type ClipboardConversion =
  | { kind: "markdown"; text: string }
  | { kind: "plain" }
  | { kind: "stripped" };

/**
 * Decide what a paste should insert. Prefers markdown when the rich flavor
 * carries structure worth keeping, and otherwise falls back to the plain-text
 * flavor — the default for anything absent, unparseable, or unchanged by
 * conversion.
 */
export function convertClipboardHtml(
  html: string,
  plainText: string
): ClipboardConversion {
  if (!html) return { kind: "plain" };

  const markdown = htmlToMarkdown(html);
  const plain = plainText.trim();

  // Markup that yields nothing at all while the clipboard holds real text is
  // the signature of a gutted payload, not of an empty copy.
  if (!markdown) return plain ? { kind: "stripped" } : { kind: "plain" };
  if (!plain) return { kind: "markdown", text: markdown };
  if (markdown === plain) return { kind: "plain" };

  const plainContent = contentCharCount(plain);
  if (
    plainContent > 0 &&
    contentCharCount(markdown) < plainContent * CONTENT_RETENTION_RATIO
  ) {
    return { kind: "stripped" };
  }
  return { kind: "markdown", text: markdown };
}

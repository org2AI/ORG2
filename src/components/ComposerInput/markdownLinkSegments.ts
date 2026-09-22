/**
 * Split converted markdown into text and link segments so the paste path can
 * turn every link into a composer pill while keeping its words as text.
 *
 * Pasting a lone URL has always produced a pill; a pasted *list* of links
 * should not behave differently just because the links arrived inside prose.
 * The scanner is deliberately conservative about what counts as a link:
 *
 *   - Fenced code blocks and inline code spans are copied through untouched —
 *     a URL inside a snippet is sample data, not a reference.
 *   - Images (`![alt](src)`) stay text; a pill would imply a reference the
 *     user did not make.
 *   - Only the link's target is inspected. Whether it can become a pill at all
 *     is the caller's decision, so an unrecognisable target can be re-emitted
 *     as the markdown it came from.
 */

export type MarkdownSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; label: string; url: string };

/** Longest run of backticks opening a fence, or 0 when the line is not one. */
function fenceLength(line: string): number {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  return match ? match[1].length : 0;
}

function fenceChar(line: string): string {
  return line.trimStart().startsWith("~") ? "~" : "`";
}

/** Scan an inline-code span starting at `start`; returns its end index. */
function skipInlineCode(text: string, start: number): number {
  const openMatch = text.slice(start).match(/^`+/);
  if (!openMatch) return start + 1;
  const fence = openMatch[0];
  const close = text.indexOf(fence, start + fence.length);
  // An unterminated span is just literal backticks — consume only the run.
  if (close === -1) return start + fence.length;
  return close + fence.length;
}

/**
 * Read a `[label](target)` link starting at `start`. Returns `null` when the
 * text is not a well-formed link, so the caller can treat `[` as literal.
 */
function readLink(
  text: string,
  start: number
): { label: string; url: string; end: number } | null {
  let depth = 0;
  let index = start;
  for (; index < text.length; index++) {
    const ch = text[index];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) break;
    } else if (ch === "\n") return null;
  }
  if (depth !== 0 || text[index + 1] !== "(") return null;

  const label = text.slice(start + 1, index);
  const targetStart = index + 2;
  const close = text.indexOf(")", targetStart);
  if (close === -1) return null;

  let url = text.slice(targetStart, close).trim();
  if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1);
  if (!url || url.includes("\n")) return null;

  return { label, url, end: close + 1 };
}

/** Trailing punctuation that belongs to the sentence, not to a bare URL. */
const BARE_URL_TRAILING = /[.,;:!?)\]}'"]+$/;

function readBareUrl(text: string, start: number): string | null {
  const match = text.slice(start).match(/^https?:\/\/[^\s<>[\]()]+/i);
  if (!match) return null;
  return match[0].replace(BARE_URL_TRAILING, "") || null;
}

/**
 * The URL word that ends exactly at `offset` in `text`, for linking an address
 * as it is typed. Same rule as a pasted bare URL: it must stand as its own
 * word, and sentence punctuation typed after it stays as text. Returns `null`
 * for a bare scheme ("https://") that has no address yet.
 */
export function findUrlWordEndingAt(
  text: string,
  offset: number
): { url: string; trailing: string; start: number } | null {
  const match = text
    .slice(0, offset)
    .match(/(?:^|\s)(https?:\/\/[^\s<>[\]()]+)$/i);
  if (!match) return null;
  const raw = match[1];
  const trailing = raw.match(BARE_URL_TRAILING)?.[0] ?? "";
  const url = raw.slice(0, raw.length - trailing.length);
  if (!/^https?:\/\/[^/]/i.test(url)) return null;
  return { url, trailing, start: offset - raw.length };
}

/** Scan one fence-free chunk, emitting text and link segments in order. */
function scanChunk(text: string, out: MarkdownSegment[]): void {
  let buffer = "";
  let index = 0;

  const flush = (): void => {
    if (buffer) out.push({ kind: "text", text: buffer });
    buffer = "";
  };

  while (index < text.length) {
    const ch = text[index];

    if (ch === "`") {
      const end = skipInlineCode(text, index);
      buffer += text.slice(index, end);
      index = end;
      continue;
    }

    // Images keep their markdown; only the link form becomes a pill.
    if (ch === "!" && text[index + 1] === "[") {
      const image = readLink(text, index + 1);
      if (image) {
        buffer += text.slice(index, image.end);
        index = image.end;
        continue;
      }
    }

    if (ch === "[") {
      const link = readLink(text, index);
      if (link) {
        flush();
        out.push({ kind: "link", label: link.label, url: link.url });
        index = link.end;
        continue;
      }
    }

    // A bare URL only counts as its own word. Inside `(...)`, quotes, or an
    // assignment it is part of code or a log line — a stack frame, a fetch
    // call — and must reach the agent exactly as pasted.
    const startsWord = index === 0 || /\s/.test(text[index - 1]);
    if (startsWord && (ch === "h" || ch === "H")) {
      const bare = readBareUrl(text, index);
      if (bare) {
        flush();
        out.push({ kind: "link", label: "", url: bare });
        index += bare.length;
        continue;
      }
    }

    buffer += ch;
    index += 1;
  }

  flush();
}

/**
 * Split `markdown` into ordered text and link segments. Concatenating a
 * `text` segment's `text` with each link rendered back as `[label](url)`
 * reproduces the input, so nothing is lost for links the caller declines.
 */
export function segmentMarkdownLinks(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const lines = markdown.split("\n");

  // Lines are collected with their newline so a chunk joins back byte-for-byte.
  let chunk: string[] = [];
  let openFence = 0;
  let openChar = "";

  const flushChunk = (): void => {
    if (chunk.length === 0) return;
    scanChunk(chunk.join(""), segments);
    chunk = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] + (index < lines.length - 1 ? "\n" : "");

    if (openFence > 0) {
      // Inside a fence: copy verbatim until a closing run at least as long as
      // the opening one appears.
      segments.push({ kind: "text", text: line });
      const closing = lines[index].match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (
        closing &&
        closing[1][0] === openChar &&
        closing[1].length >= openFence
      ) {
        openFence = 0;
      }
      continue;
    }

    const length = fenceLength(lines[index]);
    if (length > 0) {
      flushChunk();
      openFence = length;
      openChar = fenceChar(lines[index]);
      segments.push({ kind: "text", text: line });
      continue;
    }

    chunk.push(line);
  }

  flushChunk();
  return segments;
}

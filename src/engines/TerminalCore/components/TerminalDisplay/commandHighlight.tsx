import { type ReactNode, createElement } from "react";

// Decorate only a bounded prefix, even when Agent Station shows a full script.
const MAX_CHARS = 256;
const MAX_SPANS = 24;

/** Small shell preview decoration: no grammar loader, HTML, cache, or state. */
export function renderCommandHighlight(text: string): ReactNode {
  if (!text) return text;
  let end = Math.min(text.length, MAX_CHARS);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;

  const tokens =
    /#[^\n]*|"(?:\\[\s\S]|[^"\\])*(?:"|$)|'[^']*(?:'|$)|`[^`]*(?:`|$)|\$\{[^}]*\}?|\$[\w?@#*!$-]+|[|&;<>()[\]]+|\s+|\\[\s\S]?|[^\s"'`$|&;<>()[\]\\]+|./g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let spans = 0;
  let commandExpected = true;
  let heredoc = false;
  for (const match of text.slice(0, end).matchAll(tokens)) {
    const token = match[0];
    if (/^\s/.test(token)) {
      if (token.includes("\n")) {
        // A heredoc can contain any language. Do not guess shell tokens in it.
        if (heredoc) break;
        commandExpected = true;
      }
      continue;
    }
    let kind: string | undefined;
    if (token.startsWith("#")) kind = "comment";
    else if (/^["'`]/.test(token)) {
      kind = "string";
      commandExpected = false;
    } else if (token.startsWith("$")) {
      kind = "variable";
      commandExpected = false;
    } else if (/^[|&;<>()[\]]/.test(token)) {
      kind = "operator";
      heredoc ||= token.includes("<<");
      commandExpected = /^[|&;(]/.test(token);
    } else if (token.startsWith("-")) kind = "parameter";
    else if (commandExpected && !/^[\w]+=/.test(token)) {
      kind = "function";
      commandExpected = false;
    }
    if (!kind) continue;
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(
      createElement(
        "span",
        { key: match.index, className: `token ${kind}` },
        token
      )
    );
    cursor = match.index + token.length;
    if (++spans === MAX_SPANS) break;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

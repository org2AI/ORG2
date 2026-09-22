/**
 * Quoted-reply projection.
 *
 * "Reply to selection" prepends the quoted passage to the outgoing message as
 * a Markdown blockquote, so the agent reads what is being replied to and the
 * sent bubble keeps the quote in history. There is no second channel: the
 * quote is part of the message text, which is what re-editing, forking and
 * every transport already carry.
 */

/** Quoting an essay helps nobody; the reply is about a passage. */
export const QUOTED_REPLY_TEXT_LIMIT = 2000;

export function normalizeQuotedSelection(text: string): string {
  return text.trim().slice(0, QUOTED_REPLY_TEXT_LIMIT);
}

/** Render a passage as a Markdown blockquote (blank lines stay quoted). */
export function formatQuotedSelection(text: string): string {
  const normalized = normalizeQuotedSelection(text);
  if (!normalized) return "";
  return normalized
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
}

/**
 * Prepend the quote to a composed message. An empty body still yields the
 * quote alone, which is what an edit-resend of a quoted reply round-trips.
 */
export function prependQuotedSelection(text: string, quote: string): string {
  const block = formatQuotedSelection(quote);
  if (!block) return text;
  const body = text.trimStart();
  return body ? `${block}\n\n${body}` : block;
}

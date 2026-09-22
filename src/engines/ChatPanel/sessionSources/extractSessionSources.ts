/**
 * Session sources — the images and web links a user sent to the agent in
 * one session, projected from that session's user messages.
 *
 * Pure text layer behind the workstation trail's Sources section. Links are
 * read the same way the sent bubble reads them (Codex attachment envelope
 * stripped, Markdown references and serialized pills parsed, session
 * references lifted out), so a row here is always something the bubble shows
 * as a link. Bare URLs count only as their own whitespace-delimited word,
 * matching the composer's typed-URL rule.
 */
import type { SessionSourceMessage } from "@src/api/tauri/session/sessionSources";
import { parseHttpUrlPill } from "@src/components/ComposerInput/httpUrl";
import { resolvePostedReferenceHref } from "@src/components/ComposerInput/postedReferenceHref";
import {
  normalizeMarkdownReferencePills,
  parseNormalizedUserMessage,
} from "@src/engines/ChatPanel/ChatHistory/components/userMessageSegments";
import { normalizeUserMessageText } from "@src/engines/ChatPanel/ChatItems/normalizeUserMessageText";
import { projectMarkdownSessionReferences } from "@src/features/Org2Cloud/markdown/sessionReferenceProjection";
import { imageRefToRustPath } from "@src/util/file/imageRefs";

export type { SessionSourceMessage };

export type SessionSource =
  | {
      kind: "image";
      key: string;
      /** Reference as stored on the message (path, asset/data URL, transcript ref). */
      ref: string;
      /** File name, or null for an inline image that never had one. */
      fileName: string | null;
    }
  | {
      kind: "link";
      key: string;
      url: string;
      label: string;
    };

const TRAILING_SENTENCE_PUNCTUATION = /[.,;:!?]+$/u;

function imageFileName(ref: string): string | null {
  const path = imageRefToRustPath(ref);
  if (/^(?:data|blob):/iu.test(path)) return null;
  const name = path.split(/[\\/]/u).pop()?.trim();
  return name ? name : null;
}

/** Inline images have no stable identity beyond the message that sent them. */
function imageKey(ref: string, messageId: string, index: number): string {
  const path = imageRefToRustPath(ref);
  return /^(?:data|blob):/iu.test(path)
    ? `image:${messageId}:${index}`
    : `image:${path}`;
}

/** The same page reached with or without a fragment or trailing slash is one source. */
function linkKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
    return `link:${parsed.toString()}`;
  } catch {
    return `link:${url}`;
  }
}

function webHref(href: string): string | null {
  return parseHttpUrlPill(href) ? href : null;
}

function bareLinks(text: string): Array<{ url: string; label: string }> {
  const links: Array<{ url: string; label: string }> = [];
  for (const word of text.split(/\s+/u)) {
    if (!/^https?:\/\//iu.test(word)) continue;
    const reference = parseHttpUrlPill(
      word.replace(TRAILING_SENTENCE_PUNCTUATION, "")
    );
    if (reference)
      links.push({ url: reference.url, label: reference.displayName });
  }
  return links;
}

function messageLinks(
  message: SessionSourceMessage
): Array<{ url: string; label: string }> {
  const normalized = normalizeMarkdownReferencePills(
    normalizeUserMessageText(message.text, message.images)
  );
  const { text } = projectMarkdownSessionReferences(normalized);
  const links: Array<{ url: string; label: string }> = [];
  for (const segment of parseNormalizedUserMessage(text)) {
    if (segment.kind === "text") {
      links.push(...bareLinks(segment.text));
      continue;
    }
    if (segment.kind !== "pill") continue;
    const url = webHref(
      resolvePostedReferenceHref(
        segment.path,
        segment.pillType,
        segment.terminalText
      )
    );
    if (url) links.push({ url, label: segment.displayName || url });
  }
  return links;
}

/**
 * Newest message first, each message's sources in the order it listed them;
 * a source sent more than once keeps its most recent position.
 */
export function extractSessionSources(
  messages: readonly SessionSourceMessage[]
): SessionSource[] {
  const sources: SessionSource[] = [];
  const seen = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    (message.images ?? []).forEach((ref, imageIndex) => {
      const key = imageKey(ref, message.id, imageIndex);
      if (seen.has(key)) return;
      seen.add(key);
      sources.push({ kind: "image", key, ref, fileName: imageFileName(ref) });
    });
    if (!message.text) continue;
    for (const link of messageLinks(message)) {
      const key = linkKey(link.url);
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({ kind: "link", key, url: link.url, label: link.label });
    }
  }
  return sources;
}

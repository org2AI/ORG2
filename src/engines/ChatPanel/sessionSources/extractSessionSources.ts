/**
 * Session resources explicitly supplied by users, referenced in assistant
 * responses, or projected from successful structured tool results, plus grouped
 * completed tool activity (including failures).
 *
 * Pure text layer behind the workstation trail's Sources section. Links are
 * read the same way the sent bubble reads them (Codex attachment envelope
 * stripped, Markdown references and serialized pills parsed, session
 * references lifted out). Tool activity comes from explicit backend metadata,
 * independently of reference rows. Bare URLs count as a whitespace-delimited word,
 * matching the composer's typed-URL rule.
 */
import type {
  SessionSourceMessage,
  SessionToolActivity,
} from "@src/api/tauri/session/sessionSources";
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

export type SessionSourceOrigin =
  | "attachment"
  | "provided-link"
  | "provided-file"
  | "assistant-reference"
  | "tool-result";

interface SessionSourceProvenance {
  /** Latest message explicitly referencing this resource. */
  messageId?: string;
  /** Describes provision, never evidence that the agent read the resource. */
  origin?: SessionSourceOrigin;
  /** Distinct earlier provenance retained when roles reference the same resource. */
  origins?: SessionSourceOrigin[];
  toolName?: string;
}

export type SessionSource = SessionSourceProvenance &
  (
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
      }
    | {
        kind: "tool-group";
        key: string;
        group: string;
        operations: SessionToolActivity[];
      }
    | {
        kind: "file";
        key: string;
        path: string;
        fileName: string;
        /** Human-readable assistant link title, distinct from the filename. */
        title?: string;
        isDirectory: boolean;
      }
  );

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

function serializedReferences(message: SessionSourceMessage): SessionSource[] {
  const normalized = normalizeMarkdownReferencePills(
    normalizeUserMessageText(message.text, message.images)
  );
  const { text } = projectMarkdownSessionReferences(normalized);
  const references: SessionSource[] = [];
  for (const segment of parseNormalizedUserMessage(text)) {
    if (segment.kind === "text") {
      references.push(
        ...bareLinks(segment.text).map(
          (link): SessionSource => ({
            kind: "link",
            key: linkKey(link.url),
            ...link,
            messageId: message.id,
            origin: "provided-link",
          })
        )
      );
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
    if (url) {
      references.push({
        kind: "link",
        key: linkKey(url),
        url,
        label: segment.displayName || url,
        messageId: message.id,
        origin: "provided-link",
      });
    } else if (segment.pillType === "file" || segment.pillType === "folder") {
      const path = segment.path;
      // Only explicit file references become rows; free-form path mentions do not.
      references.push({
        kind: "file",
        key: `file:${path}`,
        path,
        fileName:
          path
            .replace(/[\\/]$/u, "")
            .split(/[\\/]/u)
            .pop() ||
          segment.displayName ||
          path,
        isDirectory: segment.pillType === "folder",
        messageId: message.id,
        origin: "provided-file",
      });
    }
  }
  return references;
}

function provenance(
  message: SessionSourceMessage,
  origin: SessionSourceOrigin
): SessionSourceProvenance {
  return {
    messageId: message.id,
    origin:
      message.role === "assistant"
        ? "assistant-reference"
        : message.role === "tool"
          ? "tool-result"
          : origin,
    ...(message.role === "tool" && message.toolName
      ? { toolName: message.toolName }
      : {}),
  };
}

/** Assistant Markdown carries meaningful titles that composer pills intentionally shorten. */
function assistantReferences(message: SessionSourceMessage): SessionSource[] {
  // Example code is not an offered resource. Never mine shell/log text for paths.
  const text = message.text
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/gu, "")
    .replace(/`[^`\n]*`/gu, "");
  const references: SessionSource[] = [];
  const rest = text.replace(
    /(!?)\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/gu,
    (
      match,
      image: string,
      label: string,
      rawDestination: string,
      offset: number
    ) => {
      if (offset > 0 && text[offset - 1] === "\\") return match;
      const destination = rawDestination.trim().replace(/^<|>$/gu, "");
      if (image) {
        // Remote image links remain browser links; local image refs use the established gallery.
        if (webHref(destination)) {
          references.push({
            kind: "link",
            key: linkKey(destination),
            url: destination,
            label,
          });
        } else {
          const parsed = serializedReferences({
            ...message,
            text: `[${label}](${destination})`,
          });
          const file = parsed.find((source) => source.kind === "file");
          if (file?.kind === "file")
            references.push({
              kind: "image",
              key: imageKey(file.path, message.id, references.length),
              ref: file.path,
              fileName: imageFileName(file.path),
            });
        }
        return " ";
      }
      const parsed = serializedReferences({ ...message, text: match });
      for (const source of parsed) {
        references.push(
          source.kind === "link"
            ? { ...source, label: label.trim() || source.label }
            : source.kind === "file"
              ? { ...source, title: label.trim() || undefined }
              : source
        );
      }
      return parsed.length ? " " : match;
    }
  );
  return [...references, ...serializedReferences({ ...message, text: rest })];
}

/**
 * Newest message first, each message's sources in the order it listed them;
 * a source sent more than once keeps its most recent position.
 */
export function extractSessionSources(
  messages: readonly SessionSourceMessage[]
): SessionSource[] {
  const sources: SessionSource[] = [];
  const byKey = new Map<string, SessionSource>();
  const seenCalls = new Set<string>();
  const add = (source: SessionSource) => {
    const previous = byKey.get(source.key);
    if (previous) {
      const origins = new Set([
        ...(previous.origins ?? (previous.origin ? [previous.origin] : [])),
        ...(source.origin ? [source.origin] : []),
      ]);
      if (origins.size > 1) previous.origins = [...origins];
      return;
    }
    byKey.set(source.key, source);
    sources.push(source);
  };
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const activity = message.toolActivity;
    if (activity?.callId && seenCalls.has(activity.callId)) continue;
    if (activity && activity.callId) {
      seenCalls.add(activity.callId);
      const key = `tool-group:${activity.group}`;
      const group = byKey.get(key);
      if (group?.kind === "tool-group") group.operations.push(activity);
      else
        add({
          kind: "tool-group",
          key,
          group: activity.group,
          operations: [activity],
        });
    }
    // Errors are activity only, even if an upstream producer accidentally includes references.
    if (activity?.status === "error") continue;
    (message.images ?? []).forEach((ref, imageIndex) => {
      add({
        kind: "image",
        key: imageKey(ref, message.id, imageIndex),
        ref,
        fileName: imageFileName(ref),
        ...provenance(message, "attachment"),
      });
    });
    if (!message.text) continue;
    const references =
      message.role === "assistant"
        ? assistantReferences(message)
        : serializedReferences(
            message.role === "tool"
              ? {
                  ...message,
                  // Structured tools may emit a bare pill without a composer label.
                  // The read-side pill parser requires a label before the token.
                  text: message.text.replace(
                    /(^|\n)\[(file|folder|link):([^\]\n]+)\]/gu,
                    (_match, boundary: string, kind: string, path: string) =>
                      `${boundary}${kind === "link" ? (parseHttpUrlPill(path)?.displayName ?? "Resource") : "Resource"} [${kind}:${path}]`
                  ),
                }
              : message
          );
    for (const reference of references) {
      add({
        ...reference,
        ...provenance(message, reference.origin ?? "provided-link"),
      });
    }
  }
  return sources;
}

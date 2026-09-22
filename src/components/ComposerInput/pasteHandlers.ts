/**
 * Paste handling for ComposerInput.
 *
 * Mirrors `ComposerInput/editorHandlers/pasteHandler.ts` priority order:
 *   1. Image files → forwarded to `onImagePaste`, paste suppressed.
 *   2. Composer fragment (`application/x-orgii-composer-fragment`) → re-insert
 *      text and pills from a prior cut/copy within the same editor.
 *   3. Terminal selection (`window.__orgiiLastTerminalCopy` within window) →
 *      insert a terminal pill, suppress paste.
 *   4. File reference (`application/x-orgii-file-reference`) → insert a
 *      file-reference pill with line range, suppress paste.
 *   5. Skill path or frontmatter → insert a skill pill, suppress paste.
 *   6. Otherwise, render the clipboard's `text/html` flavor to markdown (or
 *      keep the plain-text flavor when there is no structure to preserve),
 *      sanitize it, and insert it manually so `contenteditable` never pulls in
 *      formatted HTML nodes from the source.
 */
import { capPillText, storePillText } from "@src/config/pillTokens";
import { createLogger } from "@src/hooks/logger";
import type { InstalledSkill } from "@src/types/extensions";
import {
  type ReferenceDragPillData,
  clearReferenceDragData,
  getReferenceDragPillData,
} from "@src/util/dnd/referenceDragData";
import { extractSkillNameFromPath } from "@src/util/skills/skillPath";

import type { ComposerFragmentPart } from "./cutHandler";
import { parseGitHubPillUrl } from "./githubUrl";
import { convertClipboardHtml } from "./htmlToMarkdown";
import { parseHttpUrlPill } from "./httpUrl";
import { segmentMarkdownLinks } from "./markdownLinkSegments";
import { readUnsanitizedClipboardHtml } from "./nativeClipboardHtml";
import type { ComposerPillAttrs } from "./types";
import { TERMINAL_COPY_MAX_AGE, sanitizeText } from "./utils";

const logger = createLogger("ComposerInput");

export interface PasteHandlerContext {
  insertPill: (attrs: ComposerPillAttrs) => void;
  insertTextAtCaret: (text: string) => void;
  getOnImagePaste: () => ((files: File[]) => void) | undefined;
  /** Returns the current installed-skills list for paste-time matching. */
  getInstalledSkills: () => InstalledSkill[];
  /**
   * Finish a paste that needs an async round trip, as one undoable
   * transaction. Only the WebKit-sanitizer recovery path uses this; every
   * other paste completes synchronously inside the event.
   */
  runDeferred: (work: () => Promise<void>) => void;
  /**
   * The browser pill for `url` when it is the page open in an in-app browser
   * session, or `null`. Resolving it also starts loading that page's content
   * into the pill, the same as @-mentioning the tab.
   */
  resolveBrowserPill: (url: string) => ComposerPillAttrs | null;
}

export interface DropHandlerContext {
  insertPill: (attrs: ComposerPillAttrs) => void;
}

function insertReferencePill(
  ctx: DropHandlerContext,
  reference: ReferenceDragPillData
): void {
  storePillText(
    reference.pillPath,
    capPillText(JSON.stringify(reference.payload))
  );
  ctx.insertPill({
    filePath: reference.pillPath,
    fileName: reference.displayName,
    isFolder: false,
    iconType: reference.iconType,
    lineStart: null,
    lineEnd: null,
  });
}

/**
 * Returns a `drop` event handler for the contenteditable host that handles
 * PR/issue reference drag data created by source-control rows.
 * Returns `true` if the event was consumed.
 *
 * WKWebView (Tauri/macOS) strips custom MIME types from DataTransfer during
 * cross-element drags, so we fall back to the window-level drag stash when
 * `dataTransfer.getData()` returns an empty string.
 */
export function createDropHandler(ctx: DropHandlerContext) {
  return (event: DragEvent): boolean => {
    const reference = event.dataTransfer
      ? getReferenceDragPillData(event.dataTransfer)
      : null;
    if (!reference) return false;

    try {
      event.preventDefault();
      insertReferencePill(ctx, reference);
      return true;
    } finally {
      clearReferenceDragData(reference.type);
    }
  };
}

/**
 * Matches a SKILL.md frontmatter block and extracts the `name` field value.
 * Handles both full-file pastes and partial frontmatter snippets.
 */
function extractSkillNameFromFrontmatter(text: string): string | null {
  const match = text.match(/^---[\s\S]*?^name:\s*([^\s\r\n]+)/m);
  return match ? match[1].trim() : null;
}

/**
 * Finds an installed skill whose `name` or `path` matches the candidate name.
 * The path-based match normalises separators and compares the skill directory segment.
 */
function resolveSkill(
  candidateName: string,
  skills: InstalledSkill[]
): InstalledSkill | undefined {
  const lower = candidateName.toLowerCase();
  return skills.find((s) => {
    if (s.name.toLowerCase() === lower) return true;
    const normalised = s.path.replace(/\\/g, "/");
    const segments = normalised.split("/");
    const dirName = segments[segments.length - 2];
    return dirName?.toLowerCase() === lower;
  });
}

/**
 * Whether a link's own words can serve as the pill's label. The serialized pill
 * grammar splits the label from surrounding prose at the last whitespace, so a
 * label containing spaces cannot round-trip (see `sanitizePillDisplayLabel`) —
 * those stay as prose with the pill beside them instead. A label that is itself
 * a URL is rejected too: showing the raw address is the thing a pill avoids.
 */
function isUsablePillLabel(label: string): boolean {
  if (!label || /\s/.test(label)) return false;
  if (label.includes("[") || label.includes("]")) return false;
  return !/^[a-z][a-z0-9+.-]*:/iu.test(label);
}

/**
 * Build the pill a URL deserves, or `null` when it is not one we represent —
 * a relative path, a `mailto:`, a bracket-bearing URL the pill grammar cannot
 * round-trip. GitHub repo/issue/PR references get their own icon and the
 * `owner/repo#n` label, a page open in the in-app browser becomes a browser
 * pill, and anything else becomes link text.
 */
export function pillForUrl(
  url: string,
  label: string,
  resolveBrowserPill: (url: string) => ComposerPillAttrs | null
): ComposerPillAttrs | null {
  // A one-word link ("sudomaggie") reads better as its own words than as the
  // address behind them; the address moves to the pill's hover tooltip.
  const preferredName = isUsablePillLabel(label) ? label : "";

  const githubReference = parseGitHubPillUrl(url);
  if (githubReference) {
    return {
      filePath: githubReference.url,
      fileName: preferredName || githubReference.displayName,
      isFolder: false,
      iconType: githubReference.iconType,
      lineStart: null,
      lineEnd: null,
    };
  }
  // A page open in the in-app browser is a reference to that session, not an
  // ordinary link.
  const browserPill = resolveBrowserPill(url);
  if (browserPill) return browserPill;

  // Anything else is an ordinary link. It still travels as a pill so the
  // address reaches the agent, but it renders as link text — blue, underlined
  // on hover, no icon — rather than as a file-like chip.
  const httpReference = parseHttpUrlPill(url);
  if (httpReference) {
    return {
      filePath: httpReference.url,
      // The address as the user entered it — scheme, query and all.
      fileName: preferredName || httpReference.url,
      isFolder: false,
      iconType: "link",
      lineStart: null,
      lineEnd: null,
    };
  }
  return null;
}

/**
 * Min length (chars) before a JSON paste is auto-converted to a pill. Below
 * this, we leave it as raw text so the user can still hand-type small JSON
 * snippets inline without losing them to a pill.
 */
const JSON_PASTE_MIN_LENGTH = 200;
const LARGE_TEXT_PASTE_MIN_LENGTH = 4_000;
const LARGE_TEXT_PASTE_MIN_LINES = 80;

/**
 * Detect "user pasted a chunk of JSON" and propose a pill display name.
 * Returns `null` if the paste is not JSON, is shorter than the threshold,
 * or fails to parse.
 *
 * The display-name heuristic walks the top-level object (and one level of
 * nesting for the `meta`/`reactComponent` patterns produced by DevTools
 * exports) looking for an identifier-like field.
 *
 * Exported for unit tests; the runtime branch in `createPasteHandler` is the
 * only production caller.
 */
export function looksLikePastedJson(
  text: string
): { suggestedName: string; pretty: string } | null {
  const trimmed = text.trim();
  if (trimmed.length < JSON_PASTE_MIN_LENGTH) return null;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const namePicker = (
    obj: Record<string, unknown>,
    keys: readonly string[]
  ): string | null => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };

  let suggested: string | null = null;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    suggested = namePicker(obj, ["name", "fileName", "id", "title"]);
    if (!suggested) {
      // One level of nesting for common DevTools-style payloads.
      const nested = obj["reactComponent"];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        suggested = namePicker(nested as Record<string, unknown>, [
          "name",
          "displayName",
        ]);
      }
    }
  }
  if (!suggested) suggested = "pasted";
  if (suggested.length > 32) suggested = suggested.slice(0, 32);

  const pretty = JSON.stringify(value, null, 2);
  return { suggestedName: `${suggested}.json`, pretty };
}

export function looksLikeLargePlainText(text: string): boolean {
  if (text.length >= LARGE_TEXT_PASTE_MIN_LENGTH) return true;
  let lineCount = 1;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      lineCount += 1;
      if (lineCount >= LARGE_TEXT_PASTE_MIN_LINES) return true;
    }
  }
  return false;
}

/**
 * Returns a `paste` event handler suitable for attaching directly to the
 * contenteditable host. Returns `true` if the event was consumed.
 */
export function createPasteHandler(ctx: PasteHandlerContext) {
  return (event: ClipboardEvent): boolean => {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return false;

    const imageFiles: File[] = [];
    for (let index = 0; index < clipboardData.items.length; index++) {
      const item = clipboardData.items[index];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    const onImagePaste = ctx.getOnImagePaste();
    if (imageFiles.length > 0 && onImagePaste) {
      event.preventDefault();
      onImagePaste(imageFiles);
      return true;
    }

    // Composer fragment — rich paste from a prior cut/copy within this editor.
    // Handles text runs, newlines, and pills (with full metadata) in order.
    const fragmentData = clipboardData.getData(
      "application/x-orgii-composer-fragment"
    );
    if (fragmentData) {
      try {
        const parts = JSON.parse(fragmentData) as ComposerFragmentPart[];
        event.preventDefault();
        for (const part of parts) {
          if (part.kind === "text") {
            ctx.insertTextAtCaret(part.text);
          } else if (part.kind === "newline") {
            ctx.insertTextAtCaret("\n");
          } else if (part.kind === "pill") {
            ctx.insertPill(part.attrs);
          }
        }
        return true;
      } catch {
        // Malformed JSON — fall through to plain-text handling.
      }
    }

    const pastedText = clipboardData.getData("text/plain");

    const githubReference = parseGitHubPillUrl(pastedText);
    if (githubReference) {
      event.preventDefault();
      ctx.insertPill({
        filePath: githubReference.url,
        fileName: githubReference.displayName,
        isFolder: false,
        iconType: githubReference.iconType,
        lineStart: null,
        lineEnd: null,
      });
      ctx.insertTextAtCaret(" ");
      return true;
    }

    const httpReference = parseHttpUrlPill(pastedText);
    if (httpReference) {
      event.preventDefault();
      ctx.insertPill(
        ctx.resolveBrowserPill(httpReference.url) ?? {
          filePath: httpReference.url,
          fileName: httpReference.url,
          isFolder: false,
          iconType: "link",
          lineStart: null,
          lineEnd: null,
        }
      );
      ctx.insertTextAtCaret(" ");
      return true;
    }

    const terminalCopy = window.__orgiiLastTerminalCopy;
    if (
      terminalCopy &&
      pastedText &&
      pastedText === terminalCopy.text &&
      Date.now() - terminalCopy.timestamp < TERMINAL_COPY_MAX_AGE
    ) {
      const terminalRef = { ...terminalCopy };
      window.__orgiiLastTerminalCopy = undefined;
      const pillPath = `terminal://${terminalRef.sessionId}/${Date.now()}`;
      const hasRealPositions =
        terminalRef.lineStart != null && terminalRef.lineEnd != null;
      const lineCount = terminalRef.lineCount;
      ctx.insertPill({
        filePath: pillPath,
        fileName: terminalRef.sessionName,
        isFolder: false,
        iconType: "terminal",
        lineStart: hasRealPositions
          ? terminalRef.lineStart!
          : lineCount > 1
            ? 1
            : null,
        lineEnd: hasRealPositions
          ? terminalRef.lineEnd!
          : lineCount > 1
            ? lineCount
            : null,
      });
      storePillText(pillPath, capPillText(terminalRef.text));
      event.preventDefault();
      return true;
    }

    const fileRefData = clipboardData.getData(
      "application/x-orgii-file-reference"
    );
    if (fileRefData) {
      try {
        const fileRef = JSON.parse(fileRefData) as {
          filePath: string;
          fileName: string;
          lineStart: number;
          lineEnd: number;
        };
        ctx.insertPill({
          filePath: fileRef.filePath,
          fileName: fileRef.fileName,
          isFolder: false,
          iconType: "file",
          lineStart: fileRef.lineStart,
          lineEnd: fileRef.lineEnd,
        });
        event.preventDefault();
        return true;
      } catch (parseError) {
        logger.warn("Failed to parse file reference:", parseError);
      }
    }

    /**
     * Deliver pasted text: collapse it into a paste pill when the user copied
     * a large block, otherwise insert it inline. Shared so the deferred
     * recovery path makes the same choice the synchronous path would. Either
     * flavor goes in as text plus a pill per link, so a URL typed into prose is
     * a link whether it was copied from a page or from plain text.
     */
    function deliverText(text: string, isMarkdown: boolean): void {
      if (!text) return;
      if (looksLikeLargePlainText(pastedText || text)) {
        const pillPath = `paste://${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        ctx.insertPill({
          filePath: pillPath,
          fileName: isMarkdown ? "pasted.md" : "pasted.txt",
          isFolder: false,
          iconType: "paste",
          lineStart: null,
          lineEnd: null,
        });
        storePillText(pillPath, capPillText(sanitizeText(text)));
        return;
      }
      // Every link becomes a pill, its words staying as readable text ahead of
      // it — the same reference a lone pasted URL produces, just inline.
      const segments = segmentMarkdownLinks(text);
      segments.forEach((segment, index) => {
        if (segment.kind === "text") {
          ctx.insertTextAtCaret(sanitizeText(segment.text));
          return;
        }
        const pill = pillForUrl(
          segment.url,
          segment.label,
          ctx.resolveBrowserPill
        );
        if (!pill) {
          // Not a reference we can represent — keep the markdown verbatim.
          ctx.insertTextAtCaret(
            sanitizeText(
              segment.label ? `[${segment.label}](${segment.url})` : segment.url
            )
          );
          return;
        }
        // When the pill carries the link's own words, they must not also be
        // written as text — that is the duplication this avoids.
        if (segment.label && pill.fileName !== segment.label) {
          ctx.insertTextAtCaret(sanitizeText(`${segment.label} `));
        }
        ctx.insertPill(pill);
        // A pill needs a gap before following prose, but not before a line
        // break or a space the text already supplies.
        const next = segments[index + 1];
        const needsGap =
          !next || (next.kind === "text" && !/^[\s)\]]/.test(next.text));
        if (needsGap) ctx.insertTextAtCaret(" ");
      });
    }

    // Rich clipboard flavor — convert `text/html` into markdown so links, list
    // structure, code fences, and tables survive a paste from a browser, doc,
    // or spreadsheet instead of flattening into undifferentiated prose.
    // Everything above this line matches on the plain flavor first, so pill
    // detection is unaffected.
    const conversion = convertClipboardHtml(
      clipboardData.getData("text/html"),
      pastedText
    );

    // `stripped` means the markup parsed but had been emptied of its content
    // before it reached us — WebKit's paste sanitizer removing custom elements
    // and their subtrees. The bytes are still on the pasteboard, so ask the
    // platform for them and finish the paste once they arrive.
    if (conversion.kind === "stripped") {
      event.preventDefault();
      ctx.runDeferred(async () => {
        const nativeHtml = await readUnsanitizedClipboardHtml();
        const recovered = nativeHtml
          ? convertClipboardHtml(nativeHtml, pastedText)
          : null;
        const usable = recovered?.kind === "markdown";
        // Worth a line: this path only runs when the platform handed us gutted
        // markup, and whether the native re-read rescued it is the first thing
        // anyone debugging a flattened paste needs to know.
        logger.debug(
          `Clipboard HTML was stripped; native re-read ${
            usable ? "recovered structure" : "did not help"
          }`
        );
        deliverText(usable ? recovered.text : pastedText, usable);
      });
      return true;
    }

    const markdownText =
      conversion.kind === "markdown" ? conversion.text : null;
    const insertText = markdownText ?? pastedText;

    // Large JSON paste — collapse into a `paste` pill so the editor doesn't
    // get blown out by DevTools / API blob dumps. The raw JSON is stashed in
    // `storePillText` keyed by `paste://...`; submit flow auto-appends it as
    // a fenced code block via `getTerminalPillTexts()` (which iterates every
    // `CONTEXT_PILL_PREFIXES` entry, not just terminal).
    if (pastedText) {
      const jsonHit = looksLikePastedJson(pastedText);
      if (jsonHit) {
        const pillPath = `paste://${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        ctx.insertPill({
          filePath: pillPath,
          fileName: jsonHit.suggestedName,
          isFolder: false,
          iconType: "paste",
          lineStart: null,
          lineEnd: null,
        });
        storePillText(pillPath, capPillText(jsonHit.pretty));
        event.preventDefault();
        return true;
      }
    }

    // Size gate measures the plain flavor — what the user actually copied.
    // Markdown conversion can double the character count of a link-dense list
    // without adding a single word, and that expansion must not be what decides
    // whether a paste stays readable in the editor or collapses into a pill.
    // (An html-only clipboard has no plain flavor to measure, so it gates on
    // the conversion instead.)
    const sizeGateText = pastedText || insertText;
    if (sizeGateText && looksLikeLargePlainText(sizeGateText)) {
      event.preventDefault();
      deliverText(insertText, markdownText !== null);
      return true;
    }

    // Skill path / frontmatter detection.
    // Try to resolve against the installed-skills list first (to get the
    // canonical name). If the atom hasn't loaded yet — or the pasted path
    // belongs to a skill that isn't listed — fall back to the extracted name
    // directly so the pill is still inserted instead of raw text.
    if (pastedText) {
      const candidateName =
        extractSkillNameFromPath(pastedText) ??
        extractSkillNameFromFrontmatter(pastedText);
      if (candidateName) {
        const skills = ctx.getInstalledSkills();
        const skill =
          skills.length > 0 ? resolveSkill(candidateName, skills) : undefined;
        const skillName = skill?.name ?? candidateName;
        event.preventDefault();
        ctx.insertPill({
          filePath: `/${skillName}`,
          fileName: skillName,
          isFolder: false,
          iconType: "skill",
          lineStart: null,
          lineEnd: null,
        });
        ctx.insertTextAtCaret(" ");
        logger.info("Pasted text converted to skill pill:", skillName);
        return true;
      }
    }

    // Insert sanitized text — the markdown rendering of the rich flavor when
    // there was one, the plain flavor otherwise. Either way we bypass the
    // browser's default paste so no HTML nodes enter the contenteditable and
    // no IME-tofu characters reach the document.
    if (insertText) {
      event.preventDefault();
      deliverText(insertText, markdownText !== null);
      return true;
    }

    return false;
  };
}

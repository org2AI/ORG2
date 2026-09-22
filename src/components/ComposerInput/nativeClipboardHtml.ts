/**
 * Unsanitized clipboard HTML, read through the platform rather than the paste
 * event.
 *
 * WebKit sanitizes pasteboard markup before a webview's `paste` event sees it,
 * dropping elements it does not recognise together with their subtrees. On a
 * page built from custom elements — GitHub's list views, for one — that leaves
 * a skeleton: the `<ul>` and `<li>` survive while every title, link, and byline
 * inside them is gone. The original bytes are still on the pasteboard, so the
 * Rust side reads `public.html` directly and hands them back intact.
 *
 * Only the recovery path in `pasteHandlers` calls this, and only once the
 * conversion has reported that content went missing — an ordinary paste never
 * pays for the round trip.
 */
import { invoke } from "@tauri-apps/api/core";

import { createLogger } from "@src/hooks/logger";

const logger = createLogger("ComposerInput");

/**
 * Returns the clipboard's HTML flavor as the source application wrote it, or
 * `null` when it is unavailable — no HTML on the pasteboard, a payload past the
 * size cap, a non-macOS platform, or no Tauri runtime at all (tests, web). A
 * `null` here is never fatal: the caller falls back to the plain-text flavor.
 */
export async function readUnsanitizedClipboardHtml(): Promise<string | null> {
  try {
    const html = await invoke<string | null>("read_clipboard_html");
    return html && html.trim() ? html : null;
  } catch (error) {
    logger.warn("Unsanitized clipboard HTML unavailable:", error);
    return null;
  }
}

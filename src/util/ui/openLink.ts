/**
 * openLink — the one way the app opens a web address.
 *
 * - `openLink`: what clicking a link does. Opens the workstation Browser, or
 *   the system browser when the user chose that under the session menu's
 *   Navigation submenu (`linkOpenTargetAtom`).
 * - `openInBrowserApp` / `openInSystemBrowser`: for controls that name their
 *   destination ("Open as web page", "Open in external browser").
 *
 * Opening always means showing: the Browser takes the URL *and* comes into
 * view, whichever entry point asked. Callers do not choose between a
 * background tab and a visible one.
 *
 * The Browser is asked through the `open-url-in-browser` event, which
 * `useOpenUrlInBrowser` acknowledges with `preventDefault()`. Only the main
 * app layout and detached station windows mount that listener, so a request
 * nobody takes (a detached session window, the login page) goes to the
 * system browser instead of doing nothing.
 */
import { openUrl } from "@tauri-apps/plugin-opener";

import Message from "@src/components/Message";
import i18n from "@src/i18n";
import { readLinkOpenTarget } from "@src/store/ui/linkOpenTargetAtom";
import { normalizeBrowserInput } from "@src/util/url/browserUrl";

export const OPEN_URL_IN_BROWSER_EVENT = "open-url-in-browser";

export interface OpenUrlInBrowserDetail {
  url: string;
}

/** Whether a Browser in this document took the request. */
function requestBrowserApp(url: string): boolean {
  return !window.dispatchEvent(
    new CustomEvent<OpenUrlInBrowserDetail>(OPEN_URL_IN_BROWSER_EVENT, {
      detail: { url },
      cancelable: true,
    })
  );
}

/** Open `url` in the operating system's default browser. */
export function openInSystemBrowser(url: string): void {
  // The Browser's own normalization, so both destinations agree on bare
  // hosts and scheme-less input.
  const normalized = normalizeBrowserInput(url);
  if (!normalized) return;
  void openUrl(normalized).catch(() => {
    Message.error(i18n.t("sessions:cards.url.openExternalFailed"));
  });
}

/** Bring `url` up in the workstation Browser, whatever the link preference. */
export function openInBrowserApp(url: string): void {
  if (!requestBrowserApp(url)) openInSystemBrowser(url);
}

/** Open `url` where the user's Navigation preference sends links. */
export function openLink(url: string): void {
  if (readLinkOpenTarget() === "internal" && requestBrowserApp(url)) return;
  openInSystemBrowser(url);
}

/**
 * `href` plus a click handler for an anchor that should open like any other
 * link. Anchors must not also set `target="_blank"`: the shell plugin opens
 * those in the system browser from its own click listener.
 */
export function linkAnchorProps(href: string) {
  return {
    href,
    onClick: (event: { preventDefault(): void }) => {
      event.preventDefault();
      openLink(href);
    },
  };
}

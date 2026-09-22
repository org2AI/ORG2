/**
 * useOpenUrlInBrowser
 *
 * Single always-mounted listener for the "open-url-in-browser" CustomEvent.
 * Opening a URL means showing it: the tab is added (or the open one focused)
 * and My Station is brought on screen through {@link revealMyStation} — the
 * shared reveal every workstation-opening path uses. There is no notification
 * to dismiss and no "Go to Browser" step.
 *
 * Taking a request calls `preventDefault()` on the event: that is how
 * `openLink` (`@src/util/ui/openLink`) knows this document has a Browser,
 * and it sends the URL to the system browser when none takes it.
 *
 * Mount this hook exactly once, at the app root (inside BrowserProvider).
 * All per-surface ad-hoc listeners should be removed in favour of this hook.
 */
import { useEffect, useEffectEvent } from "react";

import { ROUTES } from "@src/config/routes";
import { useBrowserContext } from "@src/contexts/workstation";
import { createBrowserSessionTabId } from "@src/store/workstation/browser/tabs";
import { focusTabAtom } from "@src/store/workstation/tabRegistry";
import {
  getInstrumentedStore,
  isStoreInitialized,
} from "@src/util/core/state/instrumentedStore";
import {
  OPEN_URL_IN_BROWSER_EVENT,
  type OpenUrlInBrowserDetail,
} from "@src/util/ui/openLink";
import { revealMyStation } from "@src/util/ui/revealMyStation";
import {
  comparableBrowserUrl,
  normalizeBrowserInput,
} from "@src/util/url/browserUrl";

/**
 * Make the session's tab the active workstation tab, so the content host
 * follows it to the Browser. A brand-new session has no tab yet — the
 * sessions → tabs sync in `useBrowserTabSync` creates and activates it — and
 * `focusTabAtom` ignores a tab id that is not in the pool.
 */
function focusBrowserSessionTab(sessionId: string): void {
  if (!isStoreInitialized()) return;
  getInstrumentedStore().set(focusTabAtom, {
    tabId: createBrowserSessionTabId(sessionId),
  });
}

export function useOpenUrlInBrowser(): void {
  const { sessions, handleAddSession, handleSessionClick } =
    useBrowserContext();

  // An Effect Event reads the latest render's values, so the listener below
  // subscribes once without mirroring each value into a ref.
  const openUrl = useEffectEvent((event: Event) => {
    const { url } = (event as CustomEvent<OpenUrlInBrowserDetail>).detail;
    const normalized = normalizeBrowserInput(url);
    if (!normalized) return;
    event.preventDefault();

    const comparableUrl = comparableBrowserUrl(normalized);
    const existing = sessions.find(
      (session) => comparableBrowserUrl(session.url) === comparableUrl
    );

    if (existing) {
      handleSessionClick(existing.id);
      focusBrowserSessionTab(existing.id);
    } else {
      focusBrowserSessionTab(handleAddSession(normalized));
    }

    revealMyStation({ path: ROUTES.workStation.browser.path });
  });

  useEffect(() => {
    const handleEvent = (event: Event) => openUrl(event);
    window.addEventListener(OPEN_URL_IN_BROWSER_EVENT, handleEvent);
    return () => {
      window.removeEventListener(OPEN_URL_IN_BROWSER_EVENT, handleEvent);
    };
  }, []);
}

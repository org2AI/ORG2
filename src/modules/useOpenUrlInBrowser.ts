/**
 * useOpenUrlInBrowser
 *
 * Single always-mounted listener for the "open-url-in-browser" CustomEvent.
 * Adds the URL as a Browser tab in the background without navigating away
 * from the current page. A toast notification lets the user know a tab was
 * opened; they can switch to Browser (My Station or Agent Station) at will.
 *
 * Taking a request calls `preventDefault()` on the event: that is how
 * `openLink` (`@src/util/ui/openLink`) knows this document has a Browser,
 * and it sends the URL to the system browser when none takes it.
 *
 * Mount this hook exactly once, at the app root (inside BrowserProvider).
 * All per-surface ad-hoc listeners should be removed in favour of this hook.
 */
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useEffectEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import Message from "@src/components/Message";
import { ROUTES } from "@src/config/routes";
import { useBrowserContext } from "@src/contexts/workstation";
import { useAppNavigate as useNavigate } from "@src/hooks/navigation/useAppNavigate";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";
import {
  OPEN_URL_IN_BROWSER_EVENT,
  type OpenUrlInBrowserDetail,
} from "@src/util/ui/openLink";
import {
  comparableBrowserUrl,
  normalizeBrowserInput,
} from "@src/util/url/browserUrl";

export function useOpenUrlInBrowser(): void {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [stationMode, setStationMode] = useAtom(stationModeAtom);
  const setChatPanelMaximized = useSetAtom(chatPanelMaximizedAtom);
  const { sessions, handleAddSession, handleSessionClick } =
    useBrowserContext();

  // An Effect Event reads the latest render's values, so the listener below
  // subscribes once without mirroring each value into a ref.
  const openUrl = useEffectEvent((event: Event) => {
    const { url, navigate: shouldNavigate } = (
      event as CustomEvent<OpenUrlInBrowserDetail>
    ).detail;
    const normalized = normalizeBrowserInput(url);
    if (!normalized) return;
    event.preventDefault();

    const comparableUrl = comparableBrowserUrl(normalized);
    const existing = sessions.find(
      (session) => comparableBrowserUrl(session.url) === comparableUrl
    );

    if (existing) {
      handleSessionClick(existing.id);
    } else {
      handleAddSession(normalized);
    }

    // A detached station window has no chat pane or route to reveal, and
    // the layout atoms below are persisted — a write here would resync into
    // the MAIN window's layout. The tab has been added; the toast's
    // "Go to Browser" is the main window's affordance.
    if (isStationWindow()) return;

    const goToBrowser = () => {
      setChatPanelMaximized(false);
      setStationMode("my-station");
      navigate(ROUTES.workStation.browser.path);
    };

    if (shouldNavigate) {
      goToBrowser();
      return;
    }

    if (
      stationMode === "my-station" &&
      pathname === ROUTES.workStation.browser.path
    ) {
      // Already on the Browser page — tab switch is enough, no toast needed.
      return;
    }

    // Stay on the current page; show a toast with a "Go to Browser" button.
    Message.info({
      content: normalized,
      title: t("browser.openedInBrowser"),
      closable: true,
      duration: 6000,
      cancel: {
        label: t("browser.goToBrowser"),
        closeOnClick: true,
        onClick: goToBrowser,
      },
    });
  });

  useEffect(() => {
    const handleEvent = (event: Event) => openUrl(event);
    window.addEventListener(OPEN_URL_IN_BROWSER_EVENT, handleEvent);
    return () => {
      window.removeEventListener(OPEN_URL_IN_BROWSER_EVENT, handleEvent);
    };
  }, []);
}

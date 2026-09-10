import i18next from "i18next";
import React from "react";

import { SESSION_UI_TOKENS } from "@src/engines/ChatPanel/blocks/primitives/config";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  InternetIcon as Chrome,
  FileSymlinkIcon as FileSymlink,
  InternetIcon as Globe,
  HugeiconsIcon,
} from "@src/icons";

export function getBrowserGroupPresentation(events: SessionEvent[]): {
  icon: React.ReactNode;
  label: string;
} {
  // Prefer uiCanonical (pre-computed, alias-resolved) over the raw functionName
  // so that matching is stable even when the Rust backend renames tool aliases.
  const canonical = (ev: SessionEvent) => ev.uiCanonical || ev.functionName;

  const hasBrowser = events.some(
    (ev) =>
      canonical(ev) === "browser" ||
      (canonical(ev)?.startsWith("browser_") ?? false)
  );
  const hasSearch = events.some(
    (ev) => canonical(ev) === "web_search" || canonical(ev) === "WebSearch"
  );
  const hasFetch = events.some(
    (ev) => canonical(ev) === "web_fetch" || canonical(ev) === "WebFetch"
  );

  const iconCls = "text-text-2";
  if (hasSearch && !hasBrowser && !hasFetch)
    return {
      icon: (
        <HugeiconsIcon
          icon={Globe}
          data-icon="globe"
          size={SESSION_UI_TOKENS.ICON.SIZE_MD}
          className={iconCls}
        />
      ),
      label: i18next.t("sessions:chat.webSearchGroup"),
    };
  if (hasFetch && !hasBrowser && !hasSearch)
    return {
      icon: (
        <HugeiconsIcon
          icon={FileSymlink}
          data-icon="file-symlink"
          size={SESSION_UI_TOKENS.ICON.SIZE_MD}
          className={iconCls}
        />
      ),
      label: i18next.t("sessions:chat.webFetchGroup"),
    };
  if (hasBrowser && !hasSearch && !hasFetch)
    return {
      icon: (
        <HugeiconsIcon
          icon={Chrome}
          data-icon="chrome"
          size={SESSION_UI_TOKENS.ICON.SIZE_MD}
          className={iconCls}
        />
      ),
      label: i18next.t("sessions:chat.browserGroup"),
    };
  return {
    icon: (
      <HugeiconsIcon
        icon={Globe}
        data-icon="globe"
        size={SESSION_UI_TOKENS.ICON.SIZE_MD}
        className={iconCls}
      />
    ),
    label: i18next.t("sessions:chat.webActivityGroup"),
  };
}

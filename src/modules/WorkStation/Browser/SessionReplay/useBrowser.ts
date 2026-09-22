/**
 * useBrowser Hook
 *
 * Hook for managing browser simulator state.
 * Handles both browser (external, Playwright/CDP) and internal_browser (DOM automation) subtools.
 */
import { useMemo } from "react";

import { useSimulatorAppState } from "@src/engines/Simulator/apps/core/useSimulatorAppState";

import { BROWSER_APP_CONFIG } from "./config";
import type {
  BrowserEntry,
  InternalBrowserEntry,
  SimulatorBrowserState,
} from "./types";

export interface UseBrowserOptions {
  overrideEventId?: string;
}

export interface UseBrowserReturn {
  // External browser subtool (Playwright/CDP)
  browserEntries: BrowserEntry[];
  activeEntry: BrowserEntry | null;
  currentUrl: string | null;

  // Internal browser subtool
  internalBrowserEntries: InternalBrowserEntry[];
  activeInternalEntry: InternalBrowserEntry | null;
  activeWebview: string | null;
  isMaskShown: boolean;

  // Combined state
  activeSubtool: "browser" | "internal_browser" | null;
  selectedEntryId: string | null;
  isReplaying: boolean;
  jumpToEvent: (eventId: string) => void;
}

export function useBrowser(options: UseBrowserOptions = {}): UseBrowserReturn {
  const { state, selectedItemId, isReplaying, jumpToEvent } =
    useSimulatorAppState<SimulatorBrowserState>({
      config: BROWSER_APP_CONFIG as never,
      overrideEventId: options.overrideEventId,
    });

  const {
    browserEntries,
    activeEntry,
    currentUrl,
    internalBrowserEntries,
    activeInternalEntry,
    activeWebview,
    isMaskShown,
    activeSubtool,
  } = state;

  // Display entry for external browser subtool
  const displayEntry = useMemo(() => {
    if (selectedItemId) {
      const agentEntry = browserEntries.find(
        (entry: BrowserEntry) => entry.entryId === selectedItemId
      );
      if (agentEntry) return agentEntry;
    }
    return activeEntry;
  }, [selectedItemId, browserEntries, activeEntry]);

  // Display entry for internal browser subtool
  const displayInternalEntry = useMemo(() => {
    if (selectedItemId) {
      const internalEntry = internalBrowserEntries.find(
        (entry) => entry.entryId === selectedItemId
      );
      if (internalEntry) return internalEntry;
    }
    return activeInternalEntry;
  }, [selectedItemId, internalBrowserEntries, activeInternalEntry]);

  const displayUrl = useMemo(() => {
    if (displayEntry) return displayEntry.url;
    return currentUrl;
  }, [displayEntry, currentUrl]);

  return {
    // External browser subtool
    browserEntries,
    activeEntry: displayEntry,
    currentUrl: displayUrl,

    // Internal browser subtool
    internalBrowserEntries,
    activeInternalEntry: displayInternalEntry,
    activeWebview,
    isMaskShown,

    // Combined state
    activeSubtool,
    selectedEntryId: selectedItemId,
    isReplaying,
    jumpToEvent,
  };
}

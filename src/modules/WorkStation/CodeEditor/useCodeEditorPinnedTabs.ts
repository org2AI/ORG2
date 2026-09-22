import { useMemo } from "react";

import { usePinnedTabs } from "@src/hooks/tabHost/usePinnedTabs";
import {
  CODE_EDITOR_MAIN_TERMINAL_SESSION_ID,
  explorerTabFactory,
  sourceControlTabFactory,
  terminalTabFactory,
} from "@src/store/workstation/tabs";

import type { SourceControlFilterCounts } from "../shared/SidebarModules";

/** The editor's pinned fixture tabs (Terminal / Source Control / Explorer). */
export function useCodeEditorPinnedTabs(
  sourceControlFilterCounts: SourceControlFilterCounts
): void {
  // === Pinned tabs (always-visible icon-only tabs) ===
  // Keep the editor fixtures focused on editor tools. Workspace overview
  // lives in the chat panel so it can share the standard panel header.
  const explorerTab = useMemo(() => explorerTabFactory({}), []);
  const pinnedTabs = useMemo(
    () => [
      terminalTabFactory({
        sessionId: CODE_EDITOR_MAIN_TERMINAL_SESSION_ID,
        sessionName: "Terminal",
      }),
      sourceControlTabFactory({
        mode: "focus",
        staged: false,
        fileCount: sourceControlFilterCounts.unstaged,
        focusPath: null,
        historySelection: null,
      }),
      explorerTab,
    ],
    [explorerTab, sourceControlFilterCounts.unstaged]
  );
  // Unified surface: nothing is auto-opened. The editor fixtures
  // (Explorer / Source Control / Terminal) are no longer force-seeded on
  // mount — the pool starts empty (WorkStationStartPage) and every tab is
  // opened lazily on user action.
  usePinnedTabs({
    enabled: false,
    pinnedTabs,
    initialActiveTabId: explorerTab.id,
  });
}

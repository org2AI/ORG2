/**
 * useEditorPaneLayers
 *
 * Decides which stacked main-pane layers are mounted and visible: the
 * terminal, the retained Source Control pane and retained registry tabs.
 * Also raises the git watcher's poll rate while Source Control is on screen.
 */
import { useMemo } from "react";

import { useSourceControlAttention } from "@src/hooks/git/useSourceControlAttention";
import type { WorkStationTab } from "@src/store/workstation/tabs";
import { isRetainedTabType } from "@src/store/workstation/tabs/tabRetention";
import type { GitFile } from "@src/types/git/types";

interface UseEditorPaneLayersOptions {
  tabs: WorkStationTab[];
  activeTab: WorkStationTab | null;
  retainedTabIds: ReadonlySet<string>;
  gitFilesByPath: Map<string, GitFile>;
}

export interface EditorPaneLayersState {
  isTerminalTabActive: boolean;
  sourceControlTab: WorkStationTab | null;
  mountSourceControlPane: boolean;
  sourceControlPaneVisible: boolean;
  sourceControlBaseFiles: GitFile[];
  retainedRegistryTabs: WorkStationTab[];
  activeTabHasRetainedLayer: boolean;
}

export function useEditorPaneLayers({
  tabs,
  activeTab,
  retainedTabIds,
  gitFilesByPath,
}: UseEditorPaneLayersOptions): EditorPaneLayersState {
  const isTerminalTabActive = activeTab?.type === "terminal";
  const isSourceControlActive = activeTab?.type === "source-control";
  // While the Source Control page is on screen, the git watcher polls at
  // its fast interval; otherwise it relaxes to halve idle git load.
  useSourceControlAttention(isSourceControlActive);

  // The Source Control tab is pinned, so it is normally always present. The
  // main pane is driven from the persisted tab (not `activeTab`) because
  // the retention policy keeps it mounted while another tab is on screen.
  const sourceControlTab = useMemo(
    () => tabs.find((tab) => tab.type === "source-control") ?? null,
    [tabs]
  );
  // Mounted while active or retained (`tabRetention.ts`: hidden for a
  // bounded grace window after leaving, then released and rebuilt from
  // view state on the next visit).
  const mountSourceControlPane =
    sourceControlTab !== null &&
    (isSourceControlActive || retainedTabIds.has(sourceControlTab.id));
  const sourceControlPaneVisible =
    isSourceControlActive && !isTerminalTabActive;

  // Kept populated while the pane is mounted so a hidden Review does not
  // flash empty when it comes back.
  const sourceControlBaseFiles = useMemo(() => {
    if (!sourceControlTab || !mountSourceControlPane) return [];
    const gitStatusFiles = Array.from(gitFilesByPath.values());
    if (gitStatusFiles.length > 0) return gitStatusFiles;
    return (sourceControlTab.data.files ?? []) as GitFile[];
  }, [sourceControlTab, mountSourceControlPane, gitFilesByPath]);

  // Registry-rendered tabs the policy retains (none today in the editor
  // host — the table in `tabRetention.ts` is the switch). Each gets its
  // own keyed layer so activating it reuses the mounted instance.
  const retainedRegistryTabs = useMemo(
    () =>
      tabs.filter(
        (tab) =>
          retainedTabIds.has(tab.id) &&
          isRetainedTabType(tab.type) &&
          tab.type !== "source-control" &&
          tab.type !== "terminal"
      ),
    [retainedTabIds, tabs]
  );
  const activeTabHasRetainedLayer =
    activeTab !== null &&
    retainedRegistryTabs.some((tab) => tab.id === activeTab.id);

  return {
    isTerminalTabActive,
    sourceControlTab,
    mountSourceControlPane,
    sourceControlPaneVisible,
    sourceControlBaseFiles,
    retainedRegistryTabs,
    activeTabHasRetainedLayer,
  };
}

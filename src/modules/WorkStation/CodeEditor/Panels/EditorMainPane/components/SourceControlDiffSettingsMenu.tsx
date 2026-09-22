import { useAtomValue } from "jotai";
import React, { useRef, useState } from "react";

import { FileHeaderMoreMenu } from "@src/features/FileHeader/FileHeaderMoreMenu";
import { useEditorDisplayToggles } from "@src/hooks/settings/useEditorDisplayToggles";
import { openFindTargetNear } from "@src/scaffold/GlobalSpotlight/FindCard/findCoordinator";
import { activeStatusBarCallbacksAtom } from "@src/store/ui";
import { diffViewModeAtom } from "@src/store/workstation/codeEditor";

const noop = () => {};

/** Aggregate diffs expose review search, refresh and shared editor preferences without single-file actions. */
export function SourceControlDiffSettingsMenu({
  onRefresh,
  refreshSpinClass,
}: {
  onRefresh: () => void;
  refreshSpinClass?: string;
}) {
  const viewMode = useAtomValue(diffViewModeAtom);
  const [menuVisible, setMenuVisible] = useState(false);
  const toggles = useEditorDisplayToggles();
  const { onOpenSettings } = useAtomValue(activeStatusBarCallbacksAtom);
  // The header sits outside the diff list; the anchor finds this pane's review search.
  const anchorRef = useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchorRef} className="contents">
      <FileHeaderMoreMenu
        showReloadButton
        showSearchAction
        showGoToLineAction={false}
        showSaveAction={false}
        showDiscardAction={false}
        showCopyRelativePathAction={false}
        showRevealInFileManagerAction={false}
        showLineNumbersToggle
        showSplitCenteredLineNumbersToggle={viewMode === "split"}
        showWordWrapToggle
        showMinimapToggle={false}
        showHighlightActiveLineToggle
        showGitBlameToggle={false}
        showMoreSettingsAction={!!onOpenSettings}
        showSidebarSettings
        lineNumbersEnabled={toggles.lineNumbersEnabled}
        splitCenteredLineNumbersEnabled={
          toggles.splitCenteredLineNumbersEnabled
        }
        wordWrapEnabled={toggles.wordWrapEnabled}
        wordWrapLocked={viewMode === "split"}
        minimapEnabled={false}
        highlightActiveLineEnabled={toggles.highlightActiveLineEnabled}
        gitBlameEnabled={false}
        loading={false}
        hasUnsavedChanges={false}
        reloadSpinClass={refreshSpinClass}
        reloadMenuCoolingDown={false}
        menuVisible={menuVisible}
        setMenuVisible={setMenuVisible}
        onSaveClick={noop}
        onDiscardClick={noop}
        onSearchClick={() => {
          setMenuVisible(false);
          openFindTargetNear(anchorRef.current, "file");
        }}
        onGoToLineClick={noop}
        onCopyRelativePathClick={noop}
        onRevealInFileManagerClick={noop}
        onReloadClick={() => {
          setMenuVisible(false);
          onRefresh();
        }}
        onLineNumbersChange={toggles.onLineNumbersChange}
        onSplitCenteredLineNumbersChange={
          toggles.onSplitCenteredLineNumbersChange
        }
        onWordWrapChange={toggles.onWordWrapChange}
        onMinimapChange={noop}
        onHighlightActiveLineChange={toggles.onHighlightActiveLineChange}
        onGitBlameChange={noop}
        onMoreSettingsClick={() => {
          onOpenSettings?.();
          setMenuVisible(false);
        }}
      />
    </span>
  );
}

import { useAtomValue } from "jotai";
import React, { useState } from "react";

import { FileHeaderMoreMenu } from "@src/features/FileHeader/FileHeaderMoreMenu";
import { useEditorDisplayToggles } from "@src/hooks/settings/useEditorDisplayToggles";
import { activeStatusBarCallbacksAtom } from "@src/store/ui/workStationLayout/statusBarAtoms";

const noop = () => {};

export function SearchHeaderMoreMenu({
  onRefresh,
  loading,
}: {
  onRefresh: () => void;
  loading: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const toggles = useEditorDisplayToggles();
  const { onOpenSettings } = useAtomValue(activeStatusBarCallbacksAtom);

  return (
    <FileHeaderMoreMenu
      showReloadButton
      showSearchAction={false}
      showGoToLineAction={false}
      showSaveAction={false}
      showDiscardAction={false}
      showCopyRelativePathAction={false}
      showRevealInFileManagerAction={false}
      showLineNumbersToggle
      showWordWrapToggle
      showMinimapToggle={false}
      showHighlightActiveLineToggle
      showGitBlameToggle={false}
      showMoreSettingsAction={Boolean(onOpenSettings)}
      showSidebarSettings
      lineNumbersEnabled={toggles.lineNumbersEnabled}
      wordWrapEnabled={toggles.wordWrapEnabled}
      minimapEnabled={false}
      highlightActiveLineEnabled={toggles.highlightActiveLineEnabled}
      gitBlameEnabled={false}
      loading={loading}
      hasUnsavedChanges={false}
      reloadSpinClass={undefined}
      reloadMenuCoolingDown={false}
      menuVisible={visible}
      setMenuVisible={setVisible}
      onSaveClick={noop}
      onDiscardClick={noop}
      onSearchClick={noop}
      onGoToLineClick={noop}
      onCopyRelativePathClick={noop}
      onRevealInFileManagerClick={noop}
      onReloadClick={() => {
        setVisible(false);
        onRefresh();
      }}
      onLineNumbersChange={toggles.onLineNumbersChange}
      onWordWrapChange={toggles.onWordWrapChange}
      onMinimapChange={noop}
      onHighlightActiveLineChange={toggles.onHighlightActiveLineChange}
      onGitBlameChange={noop}
      onMoreSettingsClick={() => {
        setVisible(false);
        onOpenSettings?.();
      }}
    />
  );
}

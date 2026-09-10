import { useAtom, useAtomValue } from "jotai";
import React, { useCallback } from "react";

import Message from "@src/components/Message";
import {
  FileHeader,
  TabBarBottomPanelToggle,
} from "@src/modules/WorkStation/shared";
import { FileOperationsService } from "@src/services/file/FileOperationsService";
import {
  editorHighlightActiveLineAtom,
  editorLineNumbersAtom,
  editorShowMinimapAtom,
  editorWordWrapAtom,
} from "@src/store/ui/editorSettingsAtom";
import { activeStatusBarCallbacksAtom } from "@src/store/ui/workStationLayout/statusBarAtoms";

interface CodeEditorDefaultHeaderProps {
  enabled: boolean;
  repoDisplayName: string;
  activeFilePath: string | null;
}

export const CodeEditorDefaultHeader: React.FC<
  CodeEditorDefaultHeaderProps
> = ({ enabled, repoDisplayName, activeFilePath }) => {
  const [lineNumbers, setLineNumbers] = useAtom(editorLineNumbersAtom);
  const [wordWrap, setWordWrap] = useAtom(editorWordWrapAtom);
  const [showMinimap, setShowMinimap] = useAtom(editorShowMinimapAtom);
  const [highlightActiveLine, setHighlightActiveLine] = useAtom(
    editorHighlightActiveLineAtom
  );
  const { onOpenSettings } = useAtomValue(activeStatusBarCallbacksAtom);

  const handleLineNumbersChange = useCallback(
    (nextEnabled: boolean) => {
      setLineNumbers(nextEnabled ? "on" : "off");
    },
    [setLineNumbers]
  );

  const handleRevealInFileManager = useCallback(async () => {
    if (!activeFilePath) return;

    const result = await FileOperationsService.revealInFinder(activeFilePath);
    if (!result.success) {
      Message.error(result.message);
    }
  }, [activeFilePath]);

  return (
    <FileHeader
      publishToHost="code"
      publishEnabled={enabled}
      filePath="code-editor-default-header"
      useFileTypeIcon={false}
      disableNavigation
      plainTitle
      titleSlot={
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-1"
          title={repoDisplayName}
        >
          {repoDisplayName}
        </span>
      }
      lineNumbersEnabled={lineNumbers !== "off"}
      onLineNumbersChange={handleLineNumbersChange}
      wordWrapEnabled={wordWrap}
      onWordWrapChange={setWordWrap}
      minimapEnabled={showMinimap}
      onMinimapChange={setShowMinimap}
      highlightActiveLineEnabled={highlightActiveLine}
      onHighlightActiveLineChange={setHighlightActiveLine}
      beforeMoreMenuSlot={<TabBarBottomPanelToggle />}
      onRevealInFileManager={
        activeFilePath ? handleRevealInFileManager : undefined
      }
      onMoreSettings={onOpenSettings}
    />
  );
};

export default CodeEditorDefaultHeader;

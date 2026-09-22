import { useAtomValue } from "jotai";
import React, { useCallback } from "react";

import Message from "@src/components/Message";
import { useEditorDisplayToggles } from "@src/hooks/settings/useEditorDisplayToggles";
import { FileHeader } from "@src/modules/WorkStation/shared";
import { FileOperationsService } from "@src/services/file/FileOperationsService";
import { activeStatusBarCallbacksAtom } from "@src/store/ui/workStationLayout/statusBarAtoms";

interface CodeEditorDefaultHeaderProps {
  enabled: boolean;
  repoDisplayName: string;
  activeFilePath: string | null;
  repoPath: string;
  onRefresh?: () => void;
  loading?: boolean;
}

export const CodeEditorDefaultHeader: React.FC<
  CodeEditorDefaultHeaderProps
> = ({
  enabled,
  repoDisplayName,
  activeFilePath,
  repoPath,
  onRefresh,
  loading,
}) => {
  const toggles = useEditorDisplayToggles();
  const { onOpenSettings } = useAtomValue(activeStatusBarCallbacksAtom);

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
      repoPath={repoPath}
      onReload={onRefresh}
      loading={loading}
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
      lineNumbersEnabled={toggles.lineNumbersEnabled}
      onLineNumbersChange={toggles.onLineNumbersChange}
      wordWrapEnabled={toggles.wordWrapEnabled}
      onWordWrapChange={toggles.onWordWrapChange}
      minimapEnabled={toggles.minimapEnabled}
      onMinimapChange={toggles.onMinimapChange}
      highlightActiveLineEnabled={toggles.highlightActiveLineEnabled}
      onHighlightActiveLineChange={toggles.onHighlightActiveLineChange}
      onRevealInFileManager={
        activeFilePath ? handleRevealInFileManager : undefined
      }
      onMoreSettings={onOpenSettings}
      showSidebarSettings
    />
  );
};

export default CodeEditorDefaultHeader;

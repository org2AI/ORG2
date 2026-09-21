import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { FileHeader } from "@src/features/FileHeader";
import { copyText } from "@src/util/data/clipboard";
import { isBinaryByExtension } from "@src/util/file/binaryDetection";
import {
  getPreviewType,
  supportsSourceControlWorkingCopyPreview,
} from "@src/util/file/previewTypes";

import { DiffFileSectionContent } from "./DiffFileSectionContent";
import { DiffFileSectionHeader } from "./DiffFileSectionHeader";
import { renderDiffFilePreviewContent } from "./diffFilePreview";
import type { DiffFileSectionProps } from "./types";
import { useDiffFileSectionExpansion } from "./useDiffFileSectionExpansion";

export type { DiffFileSectionData } from "./types";

function getDisplayPath(path: string, repoPath?: string): string {
  if (!repoPath || !path.startsWith(repoPath)) return path;
  return path.slice(repoPath.length).replace(/^[/\\]/, "");
}

function getFileNameAndDir(path: string): {
  fileName: string;
  dirPath: string;
} {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return { fileName: normalized, dirPath: "" };
  return {
    fileName: normalized.slice(lastSlash + 1) || normalized,
    dirPath: normalized.slice(0, lastSlash),
  };
}

const DiffFileSection: React.FC<DiffFileSectionProps> = ({
  file,
  reviewSearch,
  viewMode,
  wordWrap,
  defaultExpanded = true,
  expansionSignal = 0,
  repoPath,
  sectionRef,
  onFileSelect,
  onRequestContent,
  onExpansionChange,
  hideDirectory = false,
  showBottomBorder = true,
  dataPath,
  showRenamePath = false,
  flat = false,
  compactHeaderGutter = false,
  noBottomPadding = false,
}) => {
  const { t } = useTranslation();
  const isDeleted = file.status === "deleted";
  const { expanded, toggleExpanded } = useDiffFileSectionExpansion({
    file,
    reviewSearch,
    defaultExpanded,
    expansionSignal,
    isDeleted,
    onRequestContent,
    onExpansionChange,
  });

  const { additions, deletions } = useMemo(() => {
    if (file.additions !== undefined && file.deletions !== undefined) {
      return { additions: file.additions, deletions: file.deletions };
    }
    const oldLines = (file.oldContent || "").split("\n");
    const newLines = (file.newContent || "").split("\n");
    return {
      additions: Math.max(0, newLines.length - oldLines.length),
      deletions: Math.max(0, oldLines.length - newLines.length),
    };
  }, [file]);

  const resolvedDiff = useMemo(
    () => ({
      oldContent: file.oldContent,
      newContent: file.newContent,
      oldStartLine: file.oldStartLine,
      newStartLine: file.newStartLine,
    }),
    [file.newContent, file.newStartLine, file.oldContent, file.oldStartLine]
  );

  const hasContent =
    !file.isUnavailable &&
    (resolvedDiff.oldContent !== undefined ||
      resolvedDiff.newContent !== undefined ||
      file.unifiedDiff !== undefined);

  const isBinary =
    file.isBinary === true ||
    isBinaryByExtension(file.path) ||
    resolvedDiff.oldContent === "Binary file - content not displayed" ||
    resolvedDiff.newContent === "Binary file - content not displayed";

  const previewType = getPreviewType(file.path);
  const isPreviewable =
    isBinary &&
    previewType !== "binary" &&
    previewType !== "code" &&
    previewType !== "database" &&
    supportsSourceControlWorkingCopyPreview(previewType);
  const absoluteFilePath =
    file.path.startsWith("/") || !repoPath
      ? file.path
      : `${repoPath}/${file.path}`;
  const canOpenFile = !isDeleted && !!onFileSelect;
  const handleOpenFile = useCallback(() => {
    onFileSelect?.(absoluteFilePath);
  }, [absoluteFilePath, onFileSelect]);

  const handleCopyPath = useCallback(() => {
    copyText(absoluteFilePath)
      .then(() => {
        Message.success(t("common:status.copiedFilePath"));
      })
      .catch(() => {
        Message.error(t("common:errors.failedToCopyFilePath"));
      });
  }, [absoluteFilePath, t]);

  const previewContent = renderDiffFilePreviewContent({
    file,
    isPreviewable,
    previewType,
    absoluteFilePath,
  });
  const displayPath = getDisplayPath(file.path, repoPath);
  const { fileName, dirPath } = getFileNameAndDir(displayPath);
  const originalDisplayPath = file.original_path
    ? getDisplayPath(file.original_path, repoPath)
    : null;
  const renamePath =
    showRenamePath &&
    file.status === "renamed" &&
    originalDisplayPath &&
    originalDisplayPath !== displayPath
      ? originalDisplayPath
      : null;

  const diffContent = (
    <DiffFileSectionContent
      file={file}
      fileName={fileName}
      displayPath={displayPath}
      expanded={expanded}
      previewContent={previewContent}
      isBinary={isBinary}
      hasContent={hasContent}
      resolvedDiff={resolvedDiff}
      reviewSearch={reviewSearch}
      viewMode={viewMode}
      wordWrap={wordWrap}
      noBottomPadding={noBottomPadding}
      t={t}
    />
  );

  if (flat) {
    return (
      <div
        ref={sectionRef}
        className={showBottomBorder ? "border-b border-border-2" : undefined}
        data-diff-section-path={dataPath}
      >
        <FileHeader
          filePath={file.path}
          repoPath={repoPath}
          additions={additions}
          deletions={deletions}
          publishEnabled={false}
        />
        {diffContent}
      </div>
    );
  }

  return (
    <div
      ref={sectionRef}
      className={showBottomBorder ? "border-b border-border-2" : undefined}
      data-diff-section-path={dataPath}
    >
      <DiffFileSectionHeader
        file={file}
        fileName={fileName}
        dirPath={dirPath}
        displayPath={displayPath}
        renamePath={renamePath}
        hideDirectory={hideDirectory}
        compactHeaderGutter={compactHeaderGutter}
        isDeleted={isDeleted}
        expanded={expanded}
        canOpenFile={canOpenFile}
        additions={additions}
        deletions={deletions}
        toggleExpanded={toggleExpanded}
        handleCopyPath={handleCopyPath}
        handleOpenFile={handleOpenFile}
        t={t}
      />

      {!isDeleted && expanded && diffContent}
    </div>
  );
};

export default memo(DiffFileSection);

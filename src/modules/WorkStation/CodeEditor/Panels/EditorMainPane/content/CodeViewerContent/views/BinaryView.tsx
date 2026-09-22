/**
 * BinaryView Component
 *
 * Routes binary/previewable files to the correct preview component based on
 * previewType from getPreviewType(). Single switch replaces the old chain of
 * 8 boolean props (isImage, isVideo, isPdf, isDocx, isXlsx, isPptx, isPages,
 * isDatabase).
 */
import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { Placeholder } from "@src/components/Placeholder";
import { LAZY_DETAIL_FALLBACK } from "@src/components/layout/blocks/LazyDetailFallback";
import { FileHeader } from "@src/modules/WorkStation/shared";
import { FileOperationsService } from "@src/services/file/FileOperationsService";
import { isTauriDesktop } from "@src/util/platform/tauri";

import {
  ImagePreview,
  PdfPreview,
  VideoPreview,
} from "../../FilePreviewContent";
import DocumentOpenMenu from "../DocumentOpenMenu";
import DocumentOpenSubmenu from "../DocumentOpenMenu/DocumentOpenSubmenu";
import { isExternalDocument } from "../DocumentOpenMenu/documentApplications";
import type { BinaryViewProps } from "../types";

const LazyDbPreviewView = React.lazy(
  () => import("../../FilePreviewContent/DbPreviewView")
);
const LazyDocxPreview = React.lazy(
  () => import("../../FilePreviewContent/DocxPreview")
);
const LazyXlsxPreview = React.lazy(
  () => import("../../FilePreviewContent/XlsxPreview")
);
const LazyPptxPreview = React.lazy(
  () => import("../../FilePreviewContent/PptxPreview")
);

export const BinaryView: React.FC<BinaryViewProps> = ({
  relativePath,
  repoPath,
  selectedFile,
  fileContent: _fileContent,
  previewType,
  readOnly,
  onFileSelect,
  onReload,
  onSaveSuccess,
  onUnsavedChange,
}) => {
  const { t } = useTranslation();
  const [previewUnsavedState, setPreviewUnsavedState] = useState({
    filePath: selectedFile,
    hasUnsavedChanges: false,
  });
  const hasPreviewUnsavedChanges =
    previewUnsavedState.filePath === selectedFile &&
    previewUnsavedState.hasUnsavedChanges;

  useEffect(() => {
    onUnsavedChange?.(false);
  }, [onUnsavedChange, selectedFile]);

  const handlePreviewUnsavedChange = useCallback(
    (hasUnsavedChanges: boolean) => {
      setPreviewUnsavedState({ filePath: selectedFile, hasUnsavedChanges });
      onUnsavedChange?.(hasUnsavedChanges);
    },
    [onUnsavedChange, selectedFile]
  );

  const handleReveal = useCallback(async () => {
    const result = await FileOperationsService.revealInFinder(selectedFile);
    if (!result.success) Message.error(result.message);
  }, [selectedFile]);

  const headerProps = {
    publishToHost: "code",
    filePath: relativePath,
    repoPath,
    onFileSelect,
    onReload,
    loading: false,
    hasUnsavedChanges: hasPreviewUnsavedChanges,
    relativePathToCopy: relativePath,
    onRevealInFileManager: isTauriDesktop() ? handleReveal : undefined,
    renderFileActions:
      isTauriDesktop() &&
      isExternalDocument(selectedFile) &&
      !hasPreviewUnsavedChanges
        ? (close: () => void) => (
            <DocumentOpenSubmenu filePath={selectedFile} onClose={close} />
          )
        : undefined,
    isMarkdownFile: false,
    isPreviewMode: true,
    onTogglePreview: undefined,
  } as const;

  switch (previewType) {
    case "image":
      return (
        <>
          <FileHeader {...headerProps} />
          <ImagePreview filePath={selectedFile} className="flex-1" />
        </>
      );

    case "video":
      return (
        <>
          <FileHeader {...headerProps} />
          <VideoPreview filePath={selectedFile} className="flex-1" />
        </>
      );

    case "pdf":
      return (
        <>
          <FileHeader {...headerProps} />
          <PdfPreview filePath={selectedFile} className="flex-1" />
        </>
      );

    case "docx":
      return (
        <>
          <FileHeader {...headerProps} />
          <Suspense fallback={LAZY_DETAIL_FALLBACK}>
            <LazyDocxPreview filePath={selectedFile} className="flex-1" />
          </Suspense>
        </>
      );

    case "xlsx":
      return (
        <>
          <FileHeader {...headerProps} />
          <Suspense fallback={LAZY_DETAIL_FALLBACK}>
            <LazyXlsxPreview
              filePath={selectedFile}
              className="flex-1"
              readOnly={readOnly}
              onSaveSuccess={onSaveSuccess}
              onUnsavedChange={handlePreviewUnsavedChange}
            />
          </Suspense>
        </>
      );

    case "pptx":
      return (
        <>
          <FileHeader {...headerProps} />
          <Suspense fallback={LAZY_DETAIL_FALLBACK}>
            <LazyPptxPreview filePath={selectedFile} className="flex-1" />
          </Suspense>
        </>
      );

    case "database":
      return (
        <>
          <FileHeader {...headerProps} />
          <Suspense fallback={LAZY_DETAIL_FALLBACK}>
            <LazyDbPreviewView filePath={selectedFile} />
          </Suspense>
        </>
      );

    default:
      return (
        <>
          <FileHeader {...headerProps} isPreviewMode={false} />
          <Placeholder
            variant="empty"
            placement="detail-panel"
            title={t("placeholders.unsupportedFileType")}
            subtitle={t("placeholders.binaryUnsupportedEncoding")}
            action={
              isTauriDesktop() && isExternalDocument(selectedFile)
                ? {
                    label: t("documentOpen.label"),
                    renderButton: (button) => (
                      <DocumentOpenMenu
                        position="bottom-start"
                        filePath={selectedFile}
                        hasUnsavedChanges={hasPreviewUnsavedChanges}
                      >
                        {button}
                      </DocumentOpenMenu>
                    ),
                  }
                : undefined
            }
            fillParentHeight
          />
        </>
      );
  }
};

export default BinaryView;

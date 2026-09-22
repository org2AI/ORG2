/**
 * Binary / previewable branch of `GitDiffContent`. Routes every non-text
 * preview type through a single switch so sentinel-tagged files and
 * untracked binaries (a newly added PNG in source control) share one path.
 */
import React, { Suspense } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/components/Placeholder";
import {
  type PreviewType,
  supportsSourceControlWorkingCopyPreview,
} from "@src/util/file/previewTypes";

const LazyImagePreview = React.lazy(
  () => import("../FilePreviewContent/ImagePreview")
);
const LazyVideoPreview = React.lazy(
  () => import("../FilePreviewContent/VideoPreview")
);
const LazyPdfPreview = React.lazy(
  () => import("../FilePreviewContent/PdfPreview")
);
const LazyDocxPreview = React.lazy(
  () => import("../FilePreviewContent/DocxPreview")
);
const LazyXlsxPreview = React.lazy(
  () => import("../FilePreviewContent/XlsxPreview")
);
const LazyPptxPreview = React.lazy(
  () => import("../FilePreviewContent/PptxPreview")
);

export interface GitDiffBinaryPreviewProps {
  absoluteFilePath: string;
  fileHeader: React.ReactNode;
  isDeleted: boolean;
  previewType: PreviewType;
  relativePath: string;
}

export function GitDiffBinaryPreview({
  absoluteFilePath,
  fileHeader,
  isDeleted,
  previewType,
  relativePath,
}: GitDiffBinaryPreviewProps) {
  const { t } = useTranslation();

  // Non-deleted previewable binary types: show the working-copy preview
  let PreviewEl: React.ReactNode = null;
  if (!isDeleted && supportsSourceControlWorkingCopyPreview(previewType)) {
    switch (previewType) {
      case "image":
        PreviewEl = (
          <LazyImagePreview filePath={absoluteFilePath} className="flex-1" />
        );
        break;
      case "video":
        PreviewEl = (
          <LazyVideoPreview filePath={absoluteFilePath} className="flex-1" />
        );
        break;
      case "pdf":
        PreviewEl = (
          <LazyPdfPreview filePath={absoluteFilePath} className="flex-1" />
        );
        break;
      case "docx":
        PreviewEl = (
          <LazyDocxPreview filePath={absoluteFilePath} className="flex-1" />
        );
        break;
      case "xlsx":
        PreviewEl = (
          <LazyXlsxPreview
            filePath={absoluteFilePath}
            className="flex-1"
            readOnly
          />
        );
        break;
      case "pptx":
        PreviewEl = (
          <LazyPptxPreview filePath={absoluteFilePath} className="flex-1" />
        );
        break;
      default:
        break;
    }
  }

  if (PreviewEl) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        {fileHeader}
        <div className="flex min-h-0 flex-1 flex-col">
          <Suspense
            fallback={
              <Placeholder
                variant="loading"
                placement="detail-panel"
                fillParentHeight
              />
            }
          >
            {PreviewEl}
          </Suspense>
        </div>
      </div>
    );
  }

  // Deleted or unsupported binary — single informational placeholder
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {fileHeader}
      <Placeholder
        variant="empty"
        placement="detail-panel"
        title={t("placeholders.previewUnavailable")}
        subtitle={relativePath}
        fillParentHeight
      />
    </div>
  );
}

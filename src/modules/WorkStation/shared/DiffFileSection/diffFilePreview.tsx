import React from "react";

import type { PreviewType } from "@src/util/file/previewTypes";

import type { DiffFileSectionData } from "./types";

const LazyImagePreview = React.lazy(
  () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/FilePreviewContent/ImagePreview")
);
const LazyVideoPreview = React.lazy(
  () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/FilePreviewContent/VideoPreview")
);
const LazyPdfPreview = React.lazy(
  () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/FilePreviewContent/PdfPreview")
);
const LazyDocxPreview = React.lazy(
  () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/FilePreviewContent/DocxPreview")
);
const LazyXlsxPreview = React.lazy(
  () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/FilePreviewContent/XlsxPreview")
);
const LazyPptxPreview = React.lazy(
  () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/FilePreviewContent/PptxPreview")
);

interface DiffFilePreviewContentOptions {
  file: DiffFileSectionData;
  isPreviewable: boolean;
  previewType: PreviewType;
  absoluteFilePath: string;
}

/** Working-copy preview element for a previewable binary file, or null. */
export function renderDiffFilePreviewContent({
  file,
  isPreviewable,
  previewType,
  absoluteFilePath,
}: DiffFilePreviewContentOptions): React.ReactNode {
  if (!isPreviewable || file.status === "deleted") return null;

  switch (previewType) {
    case "image":
      return (
        <LazyImagePreview filePath={absoluteFilePath} className="h-full" />
      );
    case "video":
      return (
        <LazyVideoPreview filePath={absoluteFilePath} className="h-full" />
      );
    case "pdf":
      return <LazyPdfPreview filePath={absoluteFilePath} className="h-full" />;
    case "docx":
      return <LazyDocxPreview filePath={absoluteFilePath} className="h-full" />;
    case "xlsx":
      return (
        <LazyXlsxPreview
          filePath={absoluteFilePath}
          className="h-full"
          readOnly
        />
      );
    case "pptx":
      return <LazyPptxPreview filePath={absoluteFilePath} className="h-full" />;
    default:
      return null;
  }
}

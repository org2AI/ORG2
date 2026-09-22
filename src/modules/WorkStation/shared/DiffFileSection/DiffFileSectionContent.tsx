import type { TFunction } from "i18next";
import React, { Suspense } from "react";

import { Placeholder } from "@src/components/Placeholder";
import type { ReviewDiffSearch } from "@src/features/CodeMirror/Diff/reviewSearchNavigation";
import type { DiffViewMode } from "@src/types/git/types";

import { SelectedTextAddToChat } from "../SelectedTextAddToChat";
import type { DiffFileSectionData } from "./types";

const LazyCodeMirrorDiff = React.lazy(
  () => import("@src/features/CodeMirror/Diff")
);

interface DiffFileSectionContentProps {
  file: DiffFileSectionData;
  fileName: string;
  displayPath: string;
  expanded: boolean;
  previewContent: React.ReactNode;
  isBinary: boolean;
  hasContent: boolean;
  resolvedDiff: {
    oldContent?: string;
    newContent?: string;
    oldStartLine?: number;
    newStartLine?: number;
  };
  reviewSearch?: ReviewDiffSearch;
  viewMode: DiffViewMode;
  wordWrap?: boolean;
  noBottomPadding: boolean;
  t: TFunction;
}

/** Diff body: working-copy preview, binary / unavailable / loading placeholder, or the CodeMirror diff. */
export function DiffFileSectionContent({
  file,
  fileName,
  displayPath,
  expanded,
  previewContent,
  isBinary,
  hasContent,
  resolvedDiff,
  reviewSearch,
  viewMode,
  wordWrap,
  noBottomPadding,
  t,
}: DiffFileSectionContentProps) {
  return (
    <SelectedTextAddToChat
      displayName={fileName || file.path}
      filePath={file.path}
      enabled={expanded}
      scopeKey={file.path}
    >
      {previewContent ? (
        <div className="h-[480px] min-h-[320px] overflow-hidden">
          <Suspense
            fallback={
              <Placeholder
                loadingIconOnly
                variant="loading"
                placement="detail-panel"
                fillParentHeight
              />
            }
          >
            {previewContent}
          </Suspense>
        </div>
      ) : isBinary ? (
        <Placeholder
          variant="empty"
          title={t("placeholders.previewUnavailable")}
          subtitle={displayPath}
        />
      ) : hasContent ? (
        <Suspense
          fallback={
            <Placeholder
              loadingIconOnly
              variant="loading"
              placement="detail-panel"
              title={t("placeholders.loadingChanges")}
            />
          }
        >
          <LazyCodeMirrorDiff
            reviewSearch={reviewSearch}
            oldValue={resolvedDiff.oldContent || ""}
            newValue={resolvedDiff.newContent || ""}
            filePath={file.path}
            changeType={file.status}
            oldStartLine={resolvedDiff.oldStartLine}
            newStartLine={resolvedDiff.newStartLine}
            showLineNumbers={file.showLineNumbers !== false}
            viewMode={viewMode}
            wordWrap={wordWrap}
            readOnly={true}
            mergeControls={false}
            collapseUnchanged={true}
            noBottomPadding={noBottomPadding}
            autoHeight
          />
        </Suspense>
      ) : file.isUnavailable ? (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("placeholders.diffContentUnavailable")}
        />
      ) : (
        <Placeholder
          loadingIconOnly
          variant="loading"
          placement="detail-panel"
          title={t("placeholders.loadingChanges")}
        />
      )}
    </SelectedTextAddToChat>
  );
}

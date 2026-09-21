import React, { Suspense, lazy, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { MarkdownFallbackBoundary } from "@src/components/MarkDown/MarkdownFallbackBoundary";
import { Placeholder } from "@src/components/Placeholder";
import { createLogger } from "@src/hooks/logger";

import { MobileFileViewerControls } from "./MobileFileViewerControls";
import { type MobileFileTarget, mobileFilePreview } from "./mobileFileTool";
import type { MobileDesktopFileAction } from "./useMobileFilePreview";

const Editor = lazy(
  () =>
    import(
      /* webpackChunkName: "mobile-readonly-editor" */ "./MobileReadonlyEditor"
    )
);

export default function MobileFileViewer({
  target,
  targets,
  onSelect,
  truncated,
  desktopAction,
}: {
  target: MobileFileTarget;
  targets: MobileFileTarget[];
  onSelect: (index: number) => void;
  truncated: boolean;
  desktopAction?: MobileDesktopFileAction;
}) {
  const { t } = useTranslation("mobileRemote");
  const fileTabsId = useId();
  const [wrap, setWrap] = useState(true);
  const preview = mobileFilePreview(target, truncated);
  const source = preview.content;
  return (
    <div className="mobile-file-viewer flex h-full min-h-0 flex-col">
      <MobileFileViewerControls
        fileTabsId={fileTabsId}
        target={target}
        targets={targets}
        onSelect={onSelect}
        preview={preview}
        truncated={truncated}
        wrap={wrap}
        onToggleWrap={() => setWrap((current) => !current)}
      />
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        data-mobile-file-document={target.filePath}
        role={targets.length > 1 ? "tabpanel" : undefined}
        id={`${fileTabsId}-panel`}
        aria-labelledby={
          targets.length > 1
            ? `${fileTabsId}-tab-${target.targetIndex}`
            : undefined
        }
        tabIndex={targets.length > 1 ? 0 : undefined}
      >
        {source === undefined ? (
          <Placeholder
            placement="detail-panel"
            variant="empty"
            title={t("fileViewer.unavailable")}
          />
        ) : (
          <>
            {source.length === 0 && !preview.original && (
              <span className="mobile-type-caption pointer-events-none absolute top-3 right-3 z-10 text-text-3">
                {t("fileViewer.empty")}
              </span>
            )}
            <MarkdownFallbackBoundary
              resetKey={`${target.filePath}:${preview.original ?? ""}:${source}`}
              label="Mobile file viewer"
              fallback={
                <div className="h-full overflow-auto p-3">
                  <p
                    role="status"
                    className="mobile-type-caption mb-2 text-text-3"
                  >
                    {t("fileViewer.plainTextFallback")}
                  </p>
                  {preview.kind === "merge" && (
                    <>
                      <p className="mobile-type-caption text-text-3">
                        {t("fileViewer.original")}
                      </p>
                      <pre
                        className={`chat-code ${wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre"}`}
                      >
                        {preview.original}
                      </pre>
                      <p className="mobile-type-caption mt-3 text-text-3">
                        {t("fileViewer.modified")}
                      </p>
                    </>
                  )}
                  <pre
                    className={`chat-code ${wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre"}`}
                  >
                    {source}
                  </pre>
                </div>
              }
            >
              <Suspense
                fallback={
                  <Placeholder
                    placement="detail-panel"
                    variant="loading"
                    title={t("transcript.tools.loadingPreview")}
                  />
                }
              >
                <Editor
                  key={`${target.targetIndex}:${target.filePath}`}
                  content={source}
                  original={preview.original}
                  filePath={target.filePath}
                  language={preview.kind === "patch" ? "diff" : target.language}
                  startLine={preview.kind === "patch" ? 1 : target.line}
                  wrap={wrap}
                />
              </Suspense>
            </MarkdownFallbackBoundary>
          </>
        )}
      </div>
      {desktopAction && (
        <div className="shrink-0 border-t border-border-2 px-3 py-1">
          {desktopAction.state.phase === "failed" && (
            <p role="alert" className="mobile-type-caption text-danger-6">
              {t("transcript.tools.openFileFailed", {
                message: desktopAction.state.message,
              })}
            </p>
          )}
          <Button
            variant="tertiary"
            size="small"
            className="min-h-11"
            style={{ fontSize: "var(--mobile-type-control-size)" }}
            loading={desktopAction.state.phase === "opening"}
            onClick={() => {
              void desktopAction
                .open()
                .catch((error) =>
                  logger.warn("Desktop navigation failed", error)
                );
            }}
            data-mobile-open-file={target.filePath}
          >
            {t(
              desktopAction.state.phase === "requested"
                ? "transcript.tools.fileOpenRequested"
                : "fileViewer.openDesktop"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

const logger = createLogger("MobileFileViewer");

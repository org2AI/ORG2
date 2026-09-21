import React, { useId } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import FileTypeIcon from "@src/components/FileTypeIcon";
import { TabPillSurface } from "@src/components/TabPill/TabPillSurface";
import {
  Copy01Icon,
  HugeiconsIcon,
  TextWrapIcon,
  Tick01Icon,
} from "@src/icons";

import type { MobileFileTarget, mobileFilePreview } from "./mobileFileTool";
import "./mobileFileViewerControls.scss";
import { useMobileCopyText } from "./useMobileCopyText";

interface MobileFileViewerControlsProps {
  fileTabsId: string;
  target: MobileFileTarget;
  targets: MobileFileTarget[];
  onSelect: (index: number) => void;
  preview: ReturnType<typeof mobileFilePreview>;
  truncated: boolean;
  wrap: boolean;
  onToggleWrap: () => void;
}

/** Local document controls; no transcript, connection or Desktop request ownership. */
export function MobileFileViewerControls({
  fileTabsId,
  target,
  targets,
  onSelect,
  preview,
  truncated,
  wrap,
  onToggleWrap,
}: MobileFileViewerControlsProps) {
  const { t } = useTranslation("mobileRemote");
  const { t: common } = useTranslation("common");
  const previewDescriptionId = useId();
  const source = preview.content;
  const clipboard = useMobileCopyText(source ?? "");
  const copyActionLabel =
    preview.kind === "merge"
      ? t("fileViewer.copyModified")
      : preview.kind === "patch"
        ? t("fileViewer.copyPatch")
        : common("actions.copy");
  const copyLabel =
    clipboard.state === "copied" ? common("status.copied") : copyActionLabel;
  const actionStyle = {
    height: "var(--mobile-file-control-size)",
    padding: "0 var(--mobile-file-control-padding)",
    fontSize: "var(--mobile-type-caption-size)",
    borderRadius: "var(--mobile-file-control-radius)",
  };
  const previewDescription = [
    truncated ? t("transcript.tools.truncated") : "",
    preview.kind === "patch" ? t("fileViewer.patchFallback") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const previewLabel = t(
    preview.kind === "snapshot"
      ? "fileViewer.snapshot"
      : preview.kind === "patch"
        ? "fileViewer.patch"
        : "fileViewer.diff"
  );
  return (
    <div className="mobile-file-controls">
      {targets.length > 1 && (
        <div
          className="mobile-file-controls__files"
          role="tablist"
          aria-orientation="horizontal"
          aria-label={t("fileViewer.files")}
        >
          {targets.map((file) => (
            <TabPillSurface
              key={`${file.targetIndex}:${file.filePath}`}
              as="button"
              isActive={target.targetIndex === file.targetIndex}
              className="mobile-file-controls__tab"
              role="tab"
              id={`${fileTabsId}-tab-${file.targetIndex}`}
              aria-controls={`${fileTabsId}-panel`}
              aria-selected={target.targetIndex === file.targetIndex}
              tabIndex={target.targetIndex === file.targetIndex ? 0 : -1}
              title={file.filePath}
              aria-label={file.filePath}
              onClick={() => onSelect(file.targetIndex)}
              onFocus={(event) =>
                event.currentTarget.scrollIntoView?.({
                  block: "nearest",
                  inline: "nearest",
                })
              }
              onKeyDown={(event) => {
                const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
                if (!keys.includes(event.key)) return;
                event.preventDefault();
                const position = targets.findIndex(
                  (item) => item.targetIndex === file.targetIndex
                );
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? targets.length - 1
                      : (position +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          targets.length) %
                        targets.length;
                const nextFile = targets[next];
                if (!nextFile) return;
                onSelect(nextFile.targetIndex);
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [next]?.focus();
              }}
              data-mobile-file-target={file.filePath}
            >
              <FileTypeIcon
                fileName={file.fileName}
                size="small"
                className="shrink-0"
              />
              <span className="truncate">{file.fileName}</span>
            </TabPillSurface>
          ))}
        </div>
      )}
      <div className="mobile-file-controls__row">
        <div
          className="mobile-file-controls__status"
          title={previewDescription || undefined}
          aria-describedby={
            previewDescription ? previewDescriptionId : undefined
          }
          data-mobile-file-status
        >
          <span className="mobile-type-caption truncate text-text-3">
            {previewLabel}
          </span>
          {truncated && (
            <span
              className="mobile-file-controls__partial mobile-type-caption"
              data-mobile-file-partial
            >
              {t("fileViewer.partial")}
            </span>
          )}
        </div>
        <div
          className="mobile-file-controls__actions"
          role="toolbar"
          aria-label={t("fileViewer.actions")}
          data-mobile-file-toolbar
        >
          <Button
            size="small"
            className="mobile-file-controls__action min-h-11"
            style={actionStyle}
            aria-label={t("fileViewer.wrap")}
            title={t("fileViewer.wrap")}
            aria-pressed={wrap}
            variant="tertiary"
            disabled={source === undefined}
            onClick={onToggleWrap}
            icon={
              <HugeiconsIcon
                icon={TextWrapIcon}
                size={18}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            }
          >
            {t("fileViewer.wrap")}
          </Button>
          <Button
            size="small"
            variant="tertiary"
            tone={clipboard.state === "copied" ? "success" : undefined}
            className="mobile-file-controls__action min-h-11"
            style={actionStyle}
            loading={clipboard.state === "pending"}
            disabled={source === undefined}
            aria-busy={clipboard.state === "pending"}
            aria-label={copyLabel}
            title={copyLabel}
            onClick={clipboard.copy}
            icon={
              <HugeiconsIcon
                icon={clipboard.state === "copied" ? Tick01Icon : Copy01Icon}
                size={18}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            }
          >
            {copyActionLabel}
          </Button>
        </div>
      </div>
      {previewDescription && (
        <span id={previewDescriptionId} className="sr-only">
          {previewDescription}
        </span>
      )}
      <span role="status" className="sr-only">
        {clipboard.state === "copied" ? common("status.copied") : ""}
      </span>
      {clipboard.state === "failed" && (
        <p role="alert" className="mobile-type-caption text-danger-6">
          {common("status.copyFailed")}
        </p>
      )}
    </div>
  );
}

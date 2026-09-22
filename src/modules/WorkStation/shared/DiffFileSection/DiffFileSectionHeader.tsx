import type { TFunction } from "i18next";

import Button from "@src/components/Button";
import DiffStatsBadge from "@src/components/DiffStatsBadge";
import FileTypeIcon from "@src/components/FileTypeIcon";
import Tooltip from "@src/components/Tooltip";
import { getStatusColor, getStatusLetterForFile } from "@src/config/gitStatus";
import {
  EDITOR_TAB_CANVAS_BG_CLASS,
  HEADER_ICON_SIZE,
} from "@src/config/workstation/tokens";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  HugeiconsIcon,
  LinkSquare02Icon,
} from "@src/icons";

import type { DiffFileSectionData } from "./types";

interface DiffFileSectionHeaderProps {
  file: DiffFileSectionData;
  fileName: string;
  dirPath: string;
  displayPath: string;
  renamePath: string | null;
  hideDirectory: boolean;
  compactHeaderGutter: boolean;
  isDeleted: boolean;
  expanded: boolean;
  canOpenFile: boolean;
  additions: number;
  deletions: number;
  toggleExpanded: () => void;
  handleCopyPath: () => void;
  handleOpenFile: () => void;
  t: TFunction;
}

/** Sticky collapsible header row: disclosure, file identity, hover actions, and change counts. */
export function DiffFileSectionHeader({
  file,
  fileName,
  dirPath,
  displayPath,
  renamePath,
  hideDirectory,
  compactHeaderGutter,
  isDeleted,
  expanded,
  canOpenFile,
  additions,
  deletions,
  toggleExpanded,
  handleCopyPath,
  handleOpenFile,
  t,
}: DiffFileSectionHeaderProps) {
  const statusLetter = getStatusLetterForFile(file.status, file.staged);
  const statusColor = getStatusColor(statusLetter);

  return (
    <div
      className={`group/diff-header sticky top-0 z-10 h-9 w-full min-w-0 ${isDeleted ? "" : "hover:bg-fill-2"} ${compactHeaderGutter ? "px-2" : "px-3"} ${EDITOR_TAB_CANVAS_BG_CLASS}`}
    >
      <Button
        layout="custom"
        className="absolute inset-0 w-full cursor-pointer focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none focus-visible:ring-inset disabled:cursor-default"
        onClick={toggleExpanded}
        disabled={isDeleted}
        aria-label={`${t(expanded ? "actions.collapse" : "actions.expand")} ${displayPath}`}
        aria-expanded={isDeleted ? undefined : expanded}
      />
      <div className="pointer-events-none relative z-10 flex h-full min-w-0 items-center gap-2 pr-2">
        {isDeleted ? (
          <span className="inline-block w-[14px] shrink-0" aria-hidden />
        ) : expanded ? (
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            data-icon="chevron-down"
            size={14}
            className="shrink-0 text-text-3"
          />
        ) : (
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            data-icon="chevron-right"
            size={14}
            className="shrink-0 text-text-3"
          />
        )}
        <FileTypeIcon
          fileName={file.path}
          size="small"
          className="shrink-0 text-text-2"
        />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
          <span className="shrink-0 text-[13px] font-medium text-text-1">
            {fileName}
          </span>
          {!hideDirectory && dirPath ? (
            <span className="min-w-0 truncate text-[11px] text-text-2">
              {dirPath}
            </span>
          ) : null}
          {renamePath ? (
            <>
              <span className="shrink-0 text-[11px] text-text-3" aria-hidden>
                ←
              </span>
              <span
                className="min-w-0 truncate text-[11px] text-text-2"
                title={`${displayPath} ← ${renamePath}`}
              >
                {renamePath}
              </span>
            </>
          ) : null}
        </div>
        <span className="-ml-2 flex w-0 shrink-0 items-center gap-px overflow-hidden opacity-0 group-focus-within/diff-header:ml-0 group-focus-within/diff-header:w-auto group-focus-within/diff-header:opacity-100 group-hover/diff-header:ml-0 group-hover/diff-header:w-auto group-hover/diff-header:opacity-100">
          <Button
            variant="tertiary"
            size="small"
            iconOnly
            className="pointer-events-auto shrink-0"
            onClick={handleCopyPath}
            title={t("actions.copyPath")}
            aria-label={`${t("actions.copyPath")}: ${displayPath}`}
            icon={
              <HugeiconsIcon icon={Copy01Icon} size={HEADER_ICON_SIZE.sm} />
            }
          />
          {canOpenFile && (
            <Button
              variant="tertiary"
              size="small"
              iconOnly
              className="pointer-events-auto shrink-0"
              onClick={handleOpenFile}
              title={t("common:actions.openInNewTab")}
              aria-label={`${t("common:actions.openInNewTab")}: ${displayPath}`}
              icon={
                <HugeiconsIcon
                  icon={LinkSquare02Icon}
                  data-icon="open-file-arrow"
                  size={HEADER_ICON_SIZE.sm}
                />
              }
            />
          )}
        </span>
        <Button
          layout="custom"
          className="pointer-events-auto flex shrink-0 cursor-pointer items-center gap-2 pr-2 focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none aria-disabled:cursor-default"
          onClick={isDeleted ? undefined : toggleExpanded}
          aria-disabled={isDeleted || undefined}
          aria-label={`${t(expanded ? "actions.collapse" : "actions.expand")} ${displayPath}`}
          aria-expanded={isDeleted ? undefined : expanded}
        >
          <DiffStatsBadge
            additions={additions}
            deletions={deletions}
            variant="compact"
            reserveValueWidth={false}
          />
          <Tooltip
            content={t(`common:gitLabels.${statusLetter}`)}
            mouseEnterDelay={500}
          >
            <span className={`shrink-0 text-[11px] font-medium ${statusColor}`}>
              {statusLetter}
            </span>
          </Tooltip>
        </Button>
      </div>
    </div>
  );
}

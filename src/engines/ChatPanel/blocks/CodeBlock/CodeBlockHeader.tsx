import type { TFunction } from "i18next";
import React from "react";

import DiffStatsBadge from "@src/components/DiffStatsBadge";
import { FileTreeHoverPreview } from "@src/components/FileTreePreview/exports";
import FileTypeIcon from "@src/components/FileTypeIcon";

import {
  EVENT_LOADING_SHIMMER_TEXT_CLASSES,
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderSubtitle,
} from "../primitives";
import { CodeBlockHeaderActions } from "./CodeBlockToolbarButtons";

const TRAILING_TAG_TONE_CLASS = {
  success: "font-medium text-success-6",
  danger: "font-medium text-danger-6",
  muted: "font-medium text-text-3",
  secondary: "font-medium text-text-2",
} as const;

interface CodeBlockHeaderTitleProps {
  actionTitle?: string;
  displayTitle: string;
  filePath?: string;
  isLoading: boolean;
  openFileInEditor: (path: string) => void;
  shared: boolean;
  showFileTreeHover: boolean;
}

/** Block title: a clickable file path (with tree hover preview when local) or plain text. */
const CodeBlockHeaderTitle: React.FC<CodeBlockHeaderTitleProps> = ({
  actionTitle,
  displayTitle,
  filePath,
  isLoading,
  openFileInEditor,
  shared,
  showFileTreeHover,
}) =>
  filePath ? (
    showFileTreeHover && !shared ? (
      <FileTreeHoverPreview
        path={filePath}
        itemType="file"
        className="flex-initial"
      >
        <div
          className={`min-w-0 cursor-pointer truncate hover:underline ${
            isLoading
              ? `font-bold ${EVENT_LOADING_SHIMMER_TEXT_CLASSES}`
              : actionTitle
                ? "text-text-2"
                : "font-medium text-text-1"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            openFileInEditor(filePath);
          }}
        >
          {displayTitle}
        </div>
      </FileTreeHoverPreview>
    ) : (
      <div
        className={`min-w-0 flex-initial cursor-pointer truncate hover:underline ${
          isLoading
            ? `font-bold ${EVENT_LOADING_SHIMMER_TEXT_CLASSES}`
            : actionTitle
              ? "text-text-2"
              : "font-medium text-text-1"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          openFileInEditor(filePath);
        }}
      >
        {displayTitle}
      </div>
    )
  ) : (
    <div
      className={`min-w-0 flex-initial truncate ${
        isLoading
          ? `font-bold ${EVENT_LOADING_SHIMMER_TEXT_CLASSES}`
          : actionTitle
            ? "text-text-2"
            : "font-medium text-text-1"
      }`}
    >
      {displayTitle}
    </div>
  );

interface CodeBlockHeaderProps {
  actionIcon?: React.ReactNode;
  actionTitle?: string;
  addedLines: number;
  code: string;
  copied: boolean;
  displayTitle: string;
  eventId?: string;
  filePath?: string;
  handleCopyContent: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleHeaderClick: () => void;
  handleHeaderMouseEnter: () => void;
  handleHeaderMouseLeave: () => void;
  handleLocate: (() => void) | undefined;
  handleOpenFile: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleTogglePreview: () => void;
  hasContent: boolean;
  iconFileName: string;
  isCollapsed: boolean;
  isFailed: boolean;
  isHeaderHovered: boolean;
  isLoading: boolean;
  isPreviewOpen: boolean;
  isPreviewable: boolean;
  openFileInEditor: (path: string) => void;
  removedLines: number;
  shared: boolean;
  shouldShowCopyButton: boolean;
  shouldShowLineCount: boolean;
  shouldShowOpenButton: boolean;
  showFileTreeHover: boolean;
  subtitle?: string;
  t: TFunction<"sessions">;
  trailingTags?: ReadonlyArray<{
    tone: "success" | "danger" | "muted" | "secondary";
    text: string;
  }>;
  useTerminalLayout: boolean;
}

/** Collapsible header row: icon, action and file titles, subtitle, diff stats, tags and actions. */
export const CodeBlockHeader: React.FC<CodeBlockHeaderProps> = ({
  actionIcon,
  actionTitle,
  addedLines,
  code,
  copied,
  displayTitle,
  eventId,
  filePath,
  handleCopyContent,
  handleHeaderClick,
  handleHeaderMouseEnter,
  handleHeaderMouseLeave,
  handleLocate,
  handleOpenFile,
  handleTogglePreview,
  hasContent,
  iconFileName,
  isCollapsed,
  isFailed,
  isHeaderHovered,
  isLoading,
  isPreviewOpen,
  isPreviewable,
  openFileInEditor,
  removedLines,
  shared,
  shouldShowCopyButton,
  shouldShowLineCount,
  shouldShowOpenButton,
  showFileTreeHover,
  subtitle,
  t,
  trailingTags,
  useTerminalLayout,
}) => (
  <EventBlockHeader
    isCollapsed={isCollapsed}
    className={
      useTerminalLayout || isCollapsed || (isLoading && !code)
        ? "border-b border-solid border-transparent"
        : "border-b border-solid border-border-1"
    }
    onToggleCollapse={hasContent ? handleHeaderClick : undefined}
    onNavigate={eventId && !shouldShowCopyButton ? handleLocate : undefined}
    onMouseEnter={handleHeaderMouseEnter}
    onMouseLeave={handleHeaderMouseLeave}
    withHover={!useTerminalLayout && hasContent}
  >
    <EventBlockHeaderIcon
      icon={
        actionIcon || (
          <FileTypeIcon
            fileName={iconFileName}
            size="small"
            className="text-primary-6"
          />
        )
      }
      isCollapsed={isCollapsed}
      isHeaderHovered={isHeaderHovered}
      iconSize={16}
      hasContent={hasContent}
      isLoading={isLoading}
      isFailed={isFailed}
    />

    {actionTitle && (
      <span
        className={`shrink-0 ${isLoading ? `font-bold ${EVENT_LOADING_SHIMMER_TEXT_CLASSES}` : "font-medium text-text-1"}`}
      >
        {actionTitle}
      </span>
    )}

    {!useTerminalLayout && (
      <>
        <CodeBlockHeaderTitle
          actionTitle={actionTitle}
          displayTitle={displayTitle}
          filePath={filePath}
          isLoading={isLoading}
          openFileInEditor={openFileInEditor}
          shared={shared}
          showFileTreeHover={showFileTreeHover}
        />

        {subtitle && (
          <EventBlockHeaderSubtitle isLoading={isLoading} title={subtitle}>
            {subtitle}
          </EventBlockHeaderSubtitle>
        )}

        {(shouldShowLineCount || (trailingTags && trailingTags.length > 0)) && (
          <span className="flex shrink-0 items-center gap-1.5">
            {shouldShowLineCount && (
              <DiffStatsBadge
                additions={addedLines}
                deletions={removedLines}
                variant="plain"
                gapClassName="gap-0"
                className="translate-y-px"
              />
            )}
            {trailingTags?.map((tag, idx) => (
              <span key={idx} className={TRAILING_TAG_TONE_CLASS[tag.tone]}>
                {tag.text}
              </span>
            ))}
          </span>
        )}

        <CodeBlockHeaderActions
          copied={copied}
          handleCopyContent={handleCopyContent}
          handleOpenFile={handleOpenFile}
          handleTogglePreview={handleTogglePreview}
          isPreviewOpen={isPreviewOpen}
          isPreviewable={isPreviewable}
          shouldShowCopyButton={shouldShowCopyButton}
          shouldShowOpenButton={shouldShowOpenButton}
          t={t}
        />
      </>
    )}
  </EventBlockHeader>
);

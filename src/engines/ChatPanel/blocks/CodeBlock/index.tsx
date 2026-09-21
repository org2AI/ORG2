/**
 * ChatCodeBlock Component
 *
 * A code block component for chat history display.
 * Features:
 * - Collapsible header with smooth animation
 * - Language-specific icons
 * - NO internal scrolling - shows limited lines with "Show more" button
 * - Hover to show collapse controls
 * - Diff syntax highlighting with + (green) and - (red)
 * - Intersection observer for lazy syntax highlighting
 * - Virtual scrolling for large code blocks (>100 lines)
 */
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  useIsSessionFileShared,
  useOpenSessionSharedFile,
} from "@src/features/Org2Cloud/SharedSessionFilesContext";
import { useCopyCheck } from "@src/hooks/ui/useCopyCheck";
import { copyText } from "@src/util/data/clipboard";
import { openFileInEditor as openLocalFileInEditor } from "@src/util/ui/openFileInEditor";

import { getEventBlockContainerClasses } from "../primitives";
import { useBlockHeader } from "../useBlockLocate";
import { CodeBlockBody } from "./CodeBlockBody";
import { CodeBlockHeader } from "./CodeBlockHeader";
import { CodeBlockFloatingToolbar } from "./CodeBlockToolbarButtons";
import CodePreview from "./CodePreview";
import type { ParsedDiff } from "./diffParser";
import "./index.scss";
import { useCodeBlockState } from "./useCodeBlockState";

// ============================================
// Types
// ============================================

interface ChatCodeBlockProps {
  code: string;
  language?: string;
  filePath?: string;
  title?: string;
  subtitle?: string;
  actionTitle?: string;
  actionIcon?: React.ReactNode;
  separateTitle?: boolean;
  defaultCollapsed?: boolean;
  maxHeight?: number;
  containerWidth?: number;
  showLineNumbers?: boolean;
  className?: string;
  hideHeader?: boolean;
  visibleLines?: number;
  linesAdded?: number;
  linesRemoved?: number;
  showLineCount?: boolean;
  diffPayload?: ParsedDiff;
  trailingTags?: ReadonlyArray<{
    tone: "success" | "danger" | "muted" | "secondary";
    text: string;
  }>;
  hasContent?: boolean;
  eventId?: string;
  isLoading?: boolean;
  isFailed?: boolean;
  showFileTreeHover?: boolean;
  showCopyButton?: boolean;
  showOpenButton?: boolean;
}

// ============================================
// Component
// ============================================

const ChatCodeBlock: React.FC<ChatCodeBlockProps> = memo(
  ({
    code,
    language,
    filePath,
    title,
    subtitle,
    actionTitle,
    actionIcon,
    separateTitle = false,
    defaultCollapsed = false,
    containerWidth,
    showLineNumbers: _showLineNumbers = true,
    className = "",
    hideHeader = false,
    visibleLines,
    linesAdded,
    linesRemoved,
    showLineCount = true,
    diffPayload,
    trailingTags,
    hasContent = true,
    eventId,
    isLoading = false,
    isFailed = false,
    showFileTreeHover = true,
    showCopyButton = true,
    showOpenButton = false,
  }) => {
    const {
      isCollapsed,
      isHeaderHovered,
      handleHeaderClick,
      handleHeaderMouseEnter,
      handleHeaderMouseLeave,
      handleLocate,
    } = useBlockHeader({ defaultCollapsed, eventId, collapseAllValue: true });
    const { t } = useTranslation("sessions");
    const openSharedFile = useOpenSessionSharedFile();
    const shared = useIsSessionFileShared();
    const openFileInEditor = useCallback(
      (path: string) => {
        if (!openSharedFile(path)) openLocalFileInEditor(path);
      },
      [openSharedFile]
    );
    const onCopyContent = useCallback(async () => {
      await copyText(code);
    }, [code]);
    const { copied, handleCopy } = useCopyCheck(onCopyContent);
    const handleCopyContent = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        handleCopy();
      },
      [handleCopy]
    );
    const handleOpenFile = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (filePath) openFileInEditor(filePath);
      },
      [filePath, openFileInEditor]
    );
    const shouldShowCopyButton =
      showCopyButton && hasContent && Boolean(code) && !isCollapsed;
    const shouldShowOpenButton =
      showOpenButton && hasContent && Boolean(filePath) && !isCollapsed;
    const shouldShowFloatingToolbar =
      hideHeader && (shouldShowOpenButton || shouldShowCopyButton);

    const {
      useTerminalLayout,
      isExpanded,
      setIsExpanded,
      isPreviewOpen,
      handleTogglePreview,
      detectedLanguage,
      isPreviewable,
      iconFileName,
      displayTitle,
      isDiff,
      addedLines,
      removedLines,
      shouldShowLineCount,
      needsExpand,
      displayedCode,
      displayedDiff,
      contentHeight,
      useVirtualScroll,
      virtualListHeight,
      streamingWrapperRef,
    } = useCodeBlockState({
      code,
      language,
      filePath,
      title,
      actionTitle,
      separateTitle,
      isLoading,
      visibleLines,
      linesAdded,
      linesRemoved,
      showLineCount,
      diffPayload,
      isCollapsed,
    });

    const containerClass = useTerminalLayout
      ? `group group/expand relative ${getEventBlockContainerClasses(false)}`
      : `group relative ${getEventBlockContainerClasses()} ${className}`;

    return (
      <div className={containerClass}>
        {!hideHeader && (
          <CodeBlockHeader
            actionIcon={actionIcon}
            actionTitle={actionTitle}
            addedLines={addedLines}
            code={code}
            copied={copied}
            displayTitle={displayTitle}
            eventId={eventId}
            filePath={filePath}
            handleCopyContent={handleCopyContent}
            handleHeaderClick={handleHeaderClick}
            handleHeaderMouseEnter={handleHeaderMouseEnter}
            handleHeaderMouseLeave={handleHeaderMouseLeave}
            handleLocate={handleLocate}
            handleOpenFile={handleOpenFile}
            handleTogglePreview={handleTogglePreview}
            hasContent={hasContent}
            iconFileName={iconFileName}
            isCollapsed={isCollapsed}
            isFailed={isFailed}
            isHeaderHovered={isHeaderHovered}
            isLoading={isLoading}
            isPreviewOpen={isPreviewOpen}
            isPreviewable={isPreviewable}
            openFileInEditor={openFileInEditor}
            removedLines={removedLines}
            shared={shared}
            shouldShowCopyButton={shouldShowCopyButton}
            shouldShowLineCount={shouldShowLineCount}
            shouldShowOpenButton={shouldShowOpenButton}
            showFileTreeHover={showFileTreeHover}
            subtitle={subtitle}
            t={t}
            trailingTags={trailingTags}
            useTerminalLayout={useTerminalLayout}
          />
        )}

        {shouldShowFloatingToolbar && (
          <CodeBlockFloatingToolbar
            copied={copied}
            handleCopyContent={handleCopyContent}
            handleOpenFile={handleOpenFile}
            shouldShowCopyButton={shouldShowCopyButton}
            shouldShowOpenButton={shouldShowOpenButton}
            t={t}
          />
        )}

        {hasContent && !isCollapsed && !(isLoading && !code) && (
          <CodeBlockBody
            code={code}
            containerWidth={containerWidth}
            contentHeight={contentHeight}
            detectedLanguage={detectedLanguage}
            displayTitle={displayTitle}
            displayedCode={displayedCode}
            displayedDiff={displayedDiff}
            filePath={filePath}
            isCollapsed={isCollapsed}
            isDiff={isDiff}
            isExpanded={isExpanded}
            isLoading={isLoading}
            needsExpand={needsExpand}
            openFileInEditor={openFileInEditor}
            setIsExpanded={setIsExpanded}
            streamingWrapperRef={streamingWrapperRef}
            useTerminalLayout={useTerminalLayout}
            useVirtualScroll={useVirtualScroll}
            virtualListHeight={virtualListHeight}
            visibleLines={visibleLines}
          />
        )}

        {isPreviewable && isPreviewOpen && (
          <CodePreview
            code={code}
            language={detectedLanguage}
            onClose={handleTogglePreview}
          />
        )}
      </div>
    );
  }
);

ChatCodeBlock.displayName = "ChatCodeBlock";

export default ChatCodeBlock;

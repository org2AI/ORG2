import React, { Suspense, lazy } from "react";

import ExpandOverlay from "@src/components/ExpandOverlay";
import FileTypeIcon from "@src/components/FileTypeIcon";

import {
  EVENT_BLOCK_FADE_FROM,
  EVENT_BLOCK_TRANSPARENT_EXPANDED_SHELL_CLASSES,
  EVENT_SNIPPET_INNER_PADDING_CLASS,
} from "../primitives";
import { getCodeBlockBodyStyle } from "./codeBlockBodyStyle";
import type { ParsedDiff } from "./diffParser";

// Lazy so the highlight engine (react-syntax-highlighter / Prism) loads
// with the first rendered code block, not with the ChatPanel startup graph.
const ModernCodeViewer = lazy(
  () => import("@src/features/CodeViewer/ModernCodeViewer")
);
const VirtualizedModernDiff = lazy(() =>
  import("@src/features/CodeViewer/VirtualizedModernDiff").then((module) => ({
    default: module.VirtualizedModernDiff,
  }))
);

interface CodeBlockBodyProps {
  code: string;
  containerWidth?: number;
  contentHeight: number;
  detectedLanguage: string;
  displayTitle: string;
  displayedCode: string;
  displayedDiff: ParsedDiff | null;
  filePath?: string;
  isCollapsed: boolean;
  isDiff: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  needsExpand: boolean;
  openFileInEditor: (path: string) => void;
  setIsExpanded: (expanded: boolean) => void;
  streamingWrapperRef: React.RefObject<HTMLDivElement | null>;
  useTerminalLayout: boolean;
  useVirtualScroll: boolean;
  virtualListHeight: number;
  visibleLines?: number;
}

/** Expanded code or diff body: streaming window, terminal file row, viewer and expand overlay. */
export const CodeBlockBody: React.FC<CodeBlockBodyProps> = ({
  code,
  containerWidth,
  contentHeight,
  detectedLanguage,
  displayTitle,
  displayedCode,
  displayedDiff,
  filePath,
  isCollapsed,
  isDiff,
  isExpanded,
  isLoading,
  needsExpand,
  openFileInEditor,
  setIsExpanded,
  streamingWrapperRef,
  useTerminalLayout,
  useVirtualScroll,
  virtualListHeight,
  visibleLines,
}) => (
  <div
    ref={isLoading && !useTerminalLayout ? streamingWrapperRef : undefined}
    className={
      useTerminalLayout
        ? EVENT_BLOCK_TRANSPARENT_EXPANDED_SHELL_CLASSES
        : `group/expand relative ${isLoading ? "scrollbar-hide" : isExpanded && needsExpand ? "scrollbar-hide" : ""}`
    }
    style={getCodeBlockBodyStyle({
      contentHeight,
      isCollapsed,
      isExpanded,
      isLoading,
      needsExpand,
      useTerminalLayout,
      visibleLines,
    })}
  >
    {useTerminalLayout && filePath && (
      <div
        className={`flex items-center gap-2 ${EVENT_SNIPPET_INNER_PADDING_CLASS}`}
      >
        <FileTypeIcon
          fileName={filePath}
          size="small"
          className="shrink-0 text-text-2"
        />
        <span
          className="min-w-0 flex-1 cursor-pointer truncate text-text-1 hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            openFileInEditor(filePath);
          }}
        >
          {displayTitle}
        </span>
      </div>
    )}

    <div
      className={
        useTerminalLayout
          ? "relative border-t border-solid border-border-1 pt-1"
          : "py-1"
      }
    >
      <div className="chat-code-block__code-container scrollbar-overlay w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden">
        <Suspense
          fallback={
            <div
              aria-hidden
              style={{
                height:
                  isDiff || !useVirtualScroll
                    ? contentHeight
                    : virtualListHeight,
              }}
            />
          }
        >
          {isDiff && displayedDiff ? (
            <VirtualizedModernDiff
              oldValue={displayedDiff.oldValue}
              newValue={displayedDiff.newValue}
              filePath={filePath}
              height={contentHeight}
              width={containerWidth}
              collapseUnchanged={true}
              contextLines={2}
              showFilePath={false}
              showStatsBar={false}
              showLineNumbers={false}
              internalScroll={false}
              noWrapper={true}
              allowExpand={false}
              indicatorStyle="border"
              className="chat-event-diff"
              oldStartLine={displayedDiff.oldStartLine}
              newStartLine={displayedDiff.newStartLine}
            />
          ) : (
            <ModernCodeViewer
              content={useVirtualScroll ? code : displayedCode}
              language={detectedLanguage}
              showLineNumbers={false}
              internalScroll={useVirtualScroll}
              height={useVirtualScroll ? virtualListHeight : contentHeight}
              width={containerWidth}
              noWrapper={true}
            />
          )}
        </Suspense>
      </div>

      {needsExpand && !isLoading && (
        <ExpandOverlay
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded(!isExpanded)}
          fadeFrom={EVENT_BLOCK_FADE_FROM}
        />
      )}
    </div>
  </div>
);

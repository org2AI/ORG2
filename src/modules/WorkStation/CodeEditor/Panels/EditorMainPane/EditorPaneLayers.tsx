/**
 * EditorPaneLayers
 *
 * The absolutely positioned layers stacked below the Code Editor header: the
 * terminal, the active tab (or the app placeholder), retained registry tabs
 * and the retained Source Control main pane. Hidden layers stay mounted and
 * toggle opacity instead of unmounting.
 */
import React, { Suspense } from "react";

import LazyDetailFallback from "@src/components/layout/blocks/LazyDetailFallback";
import { FileHeaderToolbarContext } from "@src/features/FileHeader/FileHeaderToolbarContext";
import UnifiedTabContent from "@src/modules/WorkStation/TabContent/UnifiedTabContent";
import {
  NoTabsPlaceholder,
  type QuickAction,
} from "@src/modules/WorkStation/shared";
import type { WorkStationTab } from "@src/store/workstation/tabs";

import type { SourceControlMainTabData } from "./content/sourceControlMainProps";
import type { UseFileContentManagerReturn } from "./hooks";
import type { EditorContentProps } from "./types";
import type { EditorPaneLayersState } from "./useEditorPaneLayers";
import type { UseSourceControlTabHeaderReturn } from "./useSourceControlTabHeader";

const TerminalMainContent = React.lazy(
  () => import("./content/TerminalMainContent")
);

// Empty read-only editor shown in the rare tabs-exist-but-activeTab-null window
// (see the `!activeTab` guard below). Mirrors the old TabContentRenderer's
// `!activeTab` branch.
const CodeViewerContent = React.lazy(
  () => import("./content/CodeViewerContent")
);
const SourceControlMainPane = React.lazy(
  () => import("./content/SourceControlMainPane")
);

type EditorPaneLayersProps = EditorPaneLayersState &
  UseSourceControlTabHeaderReturn &
  Pick<
    EditorContentProps,
    | "repoPath"
    | "repoId"
    | "gitFilesByPath"
    | "gitDiffLoading"
    | "onFileSelect"
    | "onFileSelectWithLine"
    | "onCursorPositionChange"
    | "terminalState"
  > & {
    shouldMountTerminalContent: boolean;
    showAppPlaceholder: boolean;
    editorQuickActions: QuickAction[];
    activeTab: WorkStationTab | null;
    activeTabId: string | null;
    fileContentManager: UseFileContentManagerReturn;
    sourceControlFilterMode: NonNullable<
      EditorContentProps["sourceControlFilterMode"]
    >;
    sourceControlActiveRepoRoot: string;
    /** Fire-and-forget git status refresh for the Source Control pane. */
    forceRefresh: () => void;
    handleGitDiffUnsavedChange: (hasUnsaved: boolean) => void;
  };

export function EditorPaneLayers({
  shouldMountTerminalContent,
  isTerminalTabActive,
  terminalState,
  repoPath,
  repoId,
  onFileSelect,
  onFileSelectWithLine,
  onCursorPositionChange,
  showAppPlaceholder,
  editorQuickActions,
  activeTab,
  activeTabId,
  activeTabHasRetainedLayer,
  fileContentManager,
  retainedRegistryTabs,
  mountSourceControlPane,
  sourceControlTab,
  sourceControlPaneVisible,
  focusToolbarTarget,
  gitFilesByPath,
  sourceControlBaseFiles,
  sourceControlFilterMode,
  sourceControlActiveRepoRoot,
  gitDiffLoading,
  sourceControlCollapseAllSignal,
  sourceControlQuickActions,
  forceRefresh,
  handleSourceControlCloseFocus,
  handleOpenSourceControlHistoryInNewTab,
  handleGitDiffUnsavedChange,
}: EditorPaneLayersProps) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {shouldMountTerminalContent && (
        <div
          className={`absolute inset-0 ${
            isTerminalTabActive
              ? "z-10 opacity-100"
              : "pointer-events-none z-0 opacity-0"
          }`}
          aria-hidden={!isTerminalTabActive}
        >
          <Suspense fallback={null}>
            <TerminalMainContent
              terminalState={terminalState}
              repoPath={repoPath}
              onFileSelect={onFileSelect}
              onFileSelectWithLine={onFileSelectWithLine}
            />
          </Suspense>
        </div>
      )}

      {!isTerminalTabActive && (
        <div className="absolute inset-0 z-10 flex min-h-0 flex-col">
          {showAppPlaceholder ? (
            <NoTabsPlaceholder icon="editor" actions={editorQuickActions} />
          ) : activeTab ? (
            activeTabHasRetainedLayer ? null : (
              <UnifiedTabContent tab={activeTab} isActive />
            )
          ) : (
            // Preserve TabContentRenderer's `!activeTab` branch: an empty
            // read-only editor. `showAppPlaceholder` already covers
            // `hasNoTabs`; this guards the rare tabs-exist-but-activeTab-null
            // window so we don't render a blank pane.
            <Suspense fallback={<LazyDetailFallback />}>
              <CodeViewerContent
                selectedFile={null}
                fileContent=""
                loading={false}
                error={null}
                repoPath={repoPath}
                onFileSelect={onFileSelect}
                onContentChange={fileContentManager.handleContentChange}
                onSave={fileContentManager.handleSave}
                onDiscard={fileContentManager.handleDiscard}
                onReload={fileContentManager.handleReload}
                hasUnsavedChanges={false}
                saving={false}
                requiresFilePreviewRoute={false}
                onCursorPositionChange={onCursorPositionChange}
              />
            </Suspense>
          )}
        </div>
      )}

      {retainedRegistryTabs.map((tab) => {
        const visible = tab.id === activeTabId && !isTerminalTabActive;
        return (
          <div
            key={tab.id}
            className={`absolute inset-0 flex min-h-0 flex-col ${
              visible ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"
            }`}
            aria-hidden={!visible}
          >
            <UnifiedTabContent tab={tab} isActive={visible} />
          </div>
        );
      })}

      {/*
        Retained Source Control main pane: shown/hidden (opacity, not
        display:none, so its scroll offsets survive) rather than
        unmounted while the policy keeps it warm.
      */}
      {mountSourceControlPane && sourceControlTab && (
        <div
          className={`absolute inset-0 flex min-h-0 flex-col ${
            sourceControlPaneVisible
              ? "z-20 opacity-100"
              : "pointer-events-none z-0 opacity-0"
          }`}
          aria-hidden={!sourceControlPaneVisible}
        >
          <Suspense fallback={<LazyDetailFallback />}>
            <FileHeaderToolbarContext.Provider
              value={
                sourceControlPaneVisible
                  ? (focusToolbarTarget ?? "host")
                  : "host"
              }
            >
              <SourceControlMainPane
                tabData={sourceControlTab.data as SourceControlMainTabData}
                repoPath={repoPath}
                repoId={repoId ?? null}
                gitFilesByPath={gitFilesByPath}
                sourceControlFiles={sourceControlBaseFiles}
                sourceControlFilterMode={sourceControlFilterMode}
                activeRepoRoot={sourceControlActiveRepoRoot}
                gitDiffLoading={gitDiffLoading}
                sourceControlCollapseAllSignal={sourceControlCollapseAllSignal}
                sourceControlQuickActions={sourceControlQuickActions}
                onForceReload={forceRefresh}
                onFileSelect={onFileSelect}
                onCloseFocus={handleSourceControlCloseFocus}
                onOpenHistoryInNewTab={handleOpenSourceControlHistoryInNewTab}
                onGitDiffUnsavedChange={handleGitDiffUnsavedChange}
                viewStateKey={sourceControlTab.id}
              />
            </FileHeaderToolbarContext.Provider>
          </Suspense>
        </div>
      )}
    </div>
  );
}

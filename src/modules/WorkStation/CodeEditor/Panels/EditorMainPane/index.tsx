/**
 * EditorContent Component
 *
 * Main content area with tabs for different view types:
 * - File editor
 * - Git diff viewer
 * - Terminal
 * - Output channels
 * - Debug console
 *
 * Architecture:
 * - TabBar is owned by AppShell (`WorkstationTabBar`).
 * - Content components (CodeViewerContent, GitDiffContent) render below
 * - Uses extracted hooks for state management and side effects
 *
 * Folder structure:
 * - content/     - Tab content renderers (CodeViewerContent, GitDiffContent, etc.)
 * - components/  - Shared subcomponents
 * - hooks/       - Extracted hooks (useEditorPaneState, useFileContentManager, etc.)
 * - types.ts     - TypeScript types
 * - config.ts    - Constants and configuration
 */
import { useAtomValue } from "jotai";
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useGitStatus } from "@src/contexts/git/GitStatusContext/useGitStatus";
import { useWorkStationTabShortcutBridge } from "@src/hooks/tabHost/useWorkStationTabShortcutBridge";
import { useActionSystem } from "@src/scaffold/ActionSystem";
import { workStationPrimarySidebarCollapsedAtom } from "@src/store/ui/workStationLayout/primarySidebarAtoms";

import { EditorPaneLayers } from "./EditorPaneLayers";
import { CodeEditorDefaultHeader } from "./components/CodeEditorDefaultHeader";
import { createEditorQuickActions } from "./config";
import { EditorHostProvider } from "./context/editorHostContext";
import { useTabContentSync, useUnsavedChangeHandlers } from "./hooks";
import "./index.scss";
import type { EditorContentProps } from "./types";
import { useEditorHostValue } from "./useEditorHostValue";
import { useEditorPaneFileState } from "./useEditorPaneFileState";
import { useEditorPaneLayers } from "./useEditorPaneLayers";
import { useSourceControlTabHeader } from "./useSourceControlTabHeader";

const NO_RETAINED_TABS: ReadonlySet<string> = new Set();

// ============================================
// Main Component
// ============================================

const EditorContent: React.FC<EditorContentProps> = memo(
  ({
    repoPath,
    repoId,
    repoDisplayName,
    onExplorerRefresh,
    explorerLoading,
    gitFilesByPath,
    gitDiffLoading,
    onFileSelect,
    onFileSelectWithLine,
    onCursorPositionChange,
    terminalState,
    retainedTabIds = NO_RETAINED_TABS,
    sourceControlHeaderLeadingSlot,
    sourceControlHeaderTrailingSlot,
    sourceControlFilterMode = "uncommitted",
    sourceControlActiveRepoRoot = repoPath,
    showSourceControlModePill = true,
  }) => {
    // ============================================
    // External Hooks
    // ============================================

    const { t } = useTranslation();
    const { dispatch } = useActionSystem();
    const { forceRefresh } = useGitStatus();

    // ============================================
    // Pane State + File Content Manager (extracted hook)
    // ============================================

    const {
      tabs,
      activeTabId,
      activeTab,
      closeTab,
      updatePaneState,
      activeFilePath,
      activeFileIsCsvTable,
      fileContentManager,
    } = useEditorPaneFileState({ forceRefresh });

    // Terminal / Source Control / retained-tab layer visibility (extracted hook)
    const paneLayers = useEditorPaneLayers({
      tabs,
      activeTab,
      retainedTabIds,
      gitFilesByPath,
    });

    // ============================================
    // Tab Content Sync (extracted hook - side effects only)
    // ============================================

    useTabContentSync({
      activeTab,
      hasUnsavedChanges:
        fileContentManager.isBinary || activeFileIsCsvTable
          ? activeTab?.hasUnsavedChanges === true ||
            fileContentManager.hasUnsavedChanges
          : fileContentManager.hasUnsavedChanges,
      fileLoading: fileContentManager.loading,
      fileContent: fileContentManager.content,
      updatePaneState,
    });

    // ============================================
    // Tab Handlers (use provided or default to internal)
    // ============================================

    const handleWorkStationCloseActiveEditorTab = useCallback(() => {
      if (activeTabId) void closeTab(activeTabId);
    }, [activeTabId, closeTab]);

    // Code Editor intentionally has no `onNewTab` handler: ⌘T has no
    // editor-specific meaning, and file lookup is owned by ⌘P (file
    // palette). In All-Tabs mode the unified `+` menu (TabBarPlusMenu)
    // claims ⌘T directly via its own `workstation-new-tab` listener.
    useWorkStationTabShortcutBridge({
      host: "code",
      onCloseActiveTab: handleWorkStationCloseActiveEditorTab,
    });

    // ============================================
    // Tab Bar Handlers
    // ============================================

    const { handleGitDiffUnsavedChange, handleBinaryUnsavedChange } =
      useUnsavedChangeHandlers({ activeTabId, updatePaneState });

    // ============================================
    // Source Control actions + tab header (extracted hook)
    // ============================================

    const sourceControlHeader = useSourceControlTabHeader({
      t,
      activeTab,
      repoId,
      repoPath,
      updatePaneState,
      forceRefresh,
      gitDiffLoading,
      sourceControlFilterMode,
      showSourceControlModePill,
      sourceControlHeaderLeadingSlot,
      sourceControlHeaderTrailingSlot,
    });

    const isExplorerHome = activeTab?.type === "explorer";

    // Panel state for dynamic quick action labels
    const sidebarCollapsed = useAtomValue(
      workStationPrimarySidebarCollapsedAtom
    );

    // Quick actions from config
    const editorQuickActions = useMemo(
      () =>
        createEditorQuickActions({
          t,
          dispatch,
          sidebarCollapsed,
        }),
      [t, dispatch, sidebarCollapsed]
    );

    // ============================================
    // Host context (Phase 2.4)
    // ============================================

    const editorHostValue = useEditorHostValue({
      fileContentManager,
      gitFilesByPath,
      gitDiffLoading,
      forceRefresh,
      onFileSelect,
      onFileSelectWithLine,
      onCursorPositionChange,
      handleGitDiffUnsavedChange,
      handleBinaryUnsavedChange,
      terminalState,
      repoPath,
      repoId,
    });

    // ============================================
    // Render
    // ============================================

    const hasNoTabs = tabs.length === 0;
    const shouldMountTerminalContent = paneLayers.isTerminalTabActive;
    // Explorer is the pinned "home" tab — its main pane reuses the same
    // empty-state placeholder we show when there are no tabs at all, so the
    // user always sees the same per-app icon + shortcut hints when they
    // have no file open.
    const showAppPlaceholder = hasNoTabs || isExplorerHome;

    return (
      <EditorHostProvider value={editorHostValue}>
        <div className="code-editor-right-panel flex h-full w-full flex-col">
          <CodeEditorDefaultHeader
            enabled={isExplorerHome}
            repoDisplayName={repoDisplayName}
            activeFilePath={activeFilePath}
            repoPath={repoPath}
            onRefresh={onExplorerRefresh}
            loading={explorerLoading}
          />
          <EditorPaneLayers
            {...paneLayers}
            {...sourceControlHeader}
            shouldMountTerminalContent={shouldMountTerminalContent}
            showAppPlaceholder={showAppPlaceholder}
            editorQuickActions={editorQuickActions}
            activeTab={activeTab}
            activeTabId={activeTabId}
            fileContentManager={fileContentManager}
            terminalState={terminalState}
            repoPath={repoPath}
            repoId={repoId}
            gitFilesByPath={gitFilesByPath}
            gitDiffLoading={gitDiffLoading}
            sourceControlFilterMode={sourceControlFilterMode}
            sourceControlActiveRepoRoot={sourceControlActiveRepoRoot}
            onFileSelect={onFileSelect}
            onFileSelectWithLine={onFileSelectWithLine}
            onCursorPositionChange={onCursorPositionChange}
            forceRefresh={forceRefresh}
            handleGitDiffUnsavedChange={handleGitDiffUnsavedChange}
          />
        </div>
      </EditorHostProvider>
    );
  }
);

EditorContent.displayName = "EditorContent";

export default EditorContent;

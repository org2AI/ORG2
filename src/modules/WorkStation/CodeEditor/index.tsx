/**
 * CodeEditor Component
 *
 * Full-featured code editor with file tree, git integration, terminal,
 * and more. Extracted from AppContainer for clean separation.
 */
import { useTerminalState } from "@/src/engines/TerminalCore/hooks/useTerminalState";
import { invoke } from "@tauri-apps/api/core";
import React, { memo, useEffect, useMemo } from "react";

import { useWorkStationPanels } from "@src/hooks/tabHost/useWorkStationPanels";
import { ActionSystemProvider } from "@src/scaffold/ActionSystem";

import { WorkStationShell } from "../shared";
// Imported from the SidebarModules entry (not the shared barrel): this
// module evaluation is also what registers the SourceControl / Terminal tab
// sidebars into TAB_SIDEBAR_REGISTRY.
import { SidebarSlot } from "../shared/SidebarModules";
import { EditorIntegrations } from "./EditorLayout/components/EditorIntegrations";
// Static imports — lazy loading added ~200-500ms of blank screen on first open
// because Suspense fallback={null} shows nothing while the chunk loads.
import EditorContent from "./Panels/EditorMainPane";
import { EditorPrimarySidebar } from "./Panels/EditorPrimarySidebar";
import { trackGitPollingVisibility } from "./gitPollingVisibility";
import { useCodeEditorEvents } from "./hooks/useCodeEditorEvents";
import { useCodeEditorHandlers } from "./hooks/useCodeEditorHandlers";
import { useGitDiffState } from "./hooks/useGitDiffState";
import { useCodeEditorLocalState } from "./useCodeEditorLocalState";
import { useCodeEditorPinnedTabs } from "./useCodeEditorPinnedTabs";
import { useCodeEditorPrimarySidebarConfig } from "./useCodeEditorPrimarySidebarConfig";
import { useCodeEditorTabs } from "./useCodeEditorTabs";
import { useCodeEditorWorkspace } from "./useCodeEditorWorkspace";
import { useEditorContentProps } from "./useEditorContentProps";
import { useEditorPrimarySidebarProps } from "./useEditorPrimarySidebarProps";
import { useLaunchpadDashboardTabCleanup } from "./useLaunchpadDashboardTabCleanup";
import { useSourceControlSetup } from "./useSourceControlSetup";

const SET_ACTIVE_GIT_POLLING_REPO_COMMAND = "set_active_git_polling_repo";

// ============================================
// Types
// ============================================

interface CodeEditorProps {
  /** Repository path to browse */
  repoPath: string;
  /** Repository name for display */
  repoName: string;
  /** Whether Code Editor is currently active in AppShell */
  isActive?: boolean;
}

// ============================================
// Main Component
// ============================================

export const CodeEditor: React.FC<CodeEditorProps> = memo(
  ({ repoPath, repoName, isActive = true }) => {
    // === Repo selection, tab cache sync, workspace folders, editor state ===
    const { currentBranch, selectedRepoId, workspaceFolders, codeEditorState } =
      useCodeEditorWorkspace(repoPath);
    const panels = useWorkStationPanels();

    // === Terminal state (unified via Jotai atoms) ===
    const terminalState = useTerminalState();

    // === Git diff state (consolidated with useReducer) ===
    const gitDiffState = useGitDiffState();

    // The single main pane's active tab. SidebarSlot resolves tab-specific
    // sidebars further below — after `useCodeEditorHandlers` runs — so git
    // file-row clicks can be wired to `handleGitFileSelect`.
    const {
      activeTab,
      tabs,
      retainedTabIds,
      retainedTabs,
      sourceControlSurfaceMounted,
    } = useCodeEditorTabs();

    // === Local state, status-bar sync, and misc handlers ===
    const {
      setPrimaryPanel,
      activeCommitSha,
      handleCursorPositionChange,
      handleSymbolClick,
      handleAllChangesClick,
    } = useCodeEditorLocalState({
      isActive,
      codeEditorState,
    });

    // === Extracted handlers (performance optimized) ===
    const handlers = useCodeEditorHandlers({
      repoPath,
      repoName,
      editorState: codeEditorState,
      setPrimaryPanel,
      gitDiffState,
    });

    useLaunchpadDashboardTabCleanup(tabs);

    // === Consolidated event listeners ===
    // Editor command-palette shortcuts now drive GlobalSpotlight's "Editor"
    // tab (no local palette instance required).
    useCodeEditorEvents({
      repoPath,
      isActive,
      setPrimaryPanel,
      selectedFile: codeEditorState.selectedFile,
      selectFile: codeEditorState.selectFile,
      gitDiffState: {
        setFiles: gitDiffState.setFiles,
        addTab: gitDiffState.addTab,
      },
    });

    // === Destructure handlers from extracted hook ===
    const { handleTimelineCommitClick, handleGitFileSelect } = handlers;

    const {
      sourceControlFilterMode,
      sourceControlFilterCounts,
      sourceControlActiveRepoRoot,
      sourceControlHeaderFilter,
      sourceControlHeaderScopePicker,
      tabSidebarExtraContext,
      handleGitFilesChange,
      handleSourceControlHistorySelectionChange,
      handleDiffSidebarFileSelect,
    } = useSourceControlSetup({
      repoPath,
      repoId: selectedRepoId,
      currentBranch,
      gitDiffState,
      activeTab,
      sourceControlSurfaceMounted,
      setPrimaryPanel,
      handleGitFileSelect,
    });

    useCodeEditorPinnedTabs(sourceControlFilterCounts);

    // Primary sidebar config using unified pattern.
    // Tab-specific sidebar (e.g. Source Control tab → Source Control
    // sidebar) wins over the default explorer sidebar; if no override is
    // registered we fall through.
    const editorPrimarySidebarProps = useEditorPrimarySidebarProps({
      codeEditorState,
      handlers,
      activeCommitSha,
      handleSymbolClick,
      repoPath,
      repoName,
      selectedRepoId,
      workspaceFolders,
    });
    const defaultSidebar = useMemo(
      () => (
        <EditorPrimarySidebar
          {...editorPrimarySidebarProps}
          onTimelineCommitClick={handleTimelineCommitClick}
        />
      ),
      [editorPrimarySidebarProps, handleTimelineCommitClick]
    );

    const sidebarContent = useMemo(
      () => (
        <SidebarSlot
          activeTab={activeTab}
          retainedTabs={retainedTabs}
          repoPath={repoPath}
          repoId={selectedRepoId}
          isMultiRoot={workspaceFolders.length > 1}
          onGitFileSelect={handleDiffSidebarFileSelect}
          onGitFilesChange={handleGitFilesChange}
          onGitHistorySelectionChange={
            handleSourceControlHistorySelectionChange
          }
          extraContext={tabSidebarExtraContext}
          defaultSidebar={defaultSidebar}
        />
      ),
      [
        activeTab,
        defaultSidebar,
        handleDiffSidebarFileSelect,
        handleGitFilesChange,
        handleSourceControlHistorySelectionChange,
        repoPath,
        retainedTabs,
        selectedRepoId,
        tabSidebarExtraContext,
        workspaceFolders.length,
      ]
    );

    const primarySidebarConfig = useCodeEditorPrimarySidebarConfig({
      sidebarContent,
      activeTab,
      panels,
    });

    const isSourceControlActive = activeTab?.type === "source-control";
    useEffect(() => {
      return trackGitPollingVisibility(
        document,
        isActive && isSourceControlActive ? selectedRepoId : null,
        (repoId) => {
          void invoke(SET_ACTIVE_GIT_POLLING_REPO_COMMAND, { repoId });
        }
      );
    }, [isActive, isSourceControlActive, selectedRepoId]);

    const editorContentProps = useEditorContentProps({
      codeEditorState,
      handlers,
      gitDiffState,
      repoPath,
      repoName,
      selectedRepoId,
      handleAllChangesClick,
      handleCursorPositionChange,
      terminalState,
      retainedTabIds,
      isSourceControlActive,
      sourceControlHeaderScopePicker,
      sourceControlHeaderFilter,
      sourceControlFilterMode,
      sourceControlActiveRepoRoot,
    });

    const mainContent = useMemo(
      () => (
        <div className="flex h-full min-h-0 w-full flex-col">
          <EditorContent
            {...editorContentProps}
            onExplorerRefresh={codeEditorState.refresh}
          />
        </div>
      ),
      [editorContentProps, codeEditorState.refresh]
    );

    return (
      <ActionSystemProvider repoPath={repoPath} repoId={selectedRepoId}>
        <EditorIntegrations
          repoPath={repoPath}
          repoId={selectedRepoId || repoPath}
        />

        <WorkStationShell
          primarySidebarConfig={primarySidebarConfig}
          content={mainContent}
          statusBar={null}
          layoutMode={panels.layoutMode}
          appClassName="code-editor"
        />
      </ActionSystemProvider>
    );
  }
);

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;

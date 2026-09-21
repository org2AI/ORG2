import { useAtomValue, useSetAtom } from "jotai";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { repoApi } from "@src/api/tauri/repo";
import Message from "@src/components/Message";
import { useRepoGitInitialization } from "@src/hooks/git";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { currentBranchAtom, sessionRepoHintAtom } from "@src/store/repo";
import { activeFolderIdAtom } from "@src/store/workspace";
import {
  activeWorkspaceRootNameAtom,
  activeWorkspaceRootPathAtom,
  activeWorktreeAtom,
} from "@src/store/workspace";

import { BaseStatusBar } from "./StatusBarBase";
import { EditorStatusBarLeft } from "./components/EditorStatusBarLeft";
import { EditorStatusBarRight } from "./components/EditorStatusBarRight";
import type { EditorStatusBarProps } from "./types";
import { useEditorStatusBarGit } from "./utils/useEditorStatusBarGit";

export type { CommitInfo, CursorPosition, EditorStatusBarProps } from "./types";

export const EditorStatusBar: React.FC<EditorStatusBarProps> = memo(
  ({
    cursor,
    totalLines,
    commitInfo,
    onRepoClick,
    onBranchClick,
    onWorktreeClick,
    className = "",
  }) => {
    const { t } = useTranslation();
    const hasSelection = cursor?.selectedChars && cursor.selectedChars > 0;

    // Workspace and branch identity are read straight from the global
    // workspace/repo atoms, never pushed in by a content host: the status bar
    // outlives the Code Editor, which unmounts on the empty Launchpad
    // (`hostMountPolicy.ts`). Only genuinely file-scoped values (cursor, path,
    // commit tab) arrive as props.
    const repoPath = useAtomValue(activeWorkspaceRootPathAtom);
    const repoName = useAtomValue(activeWorkspaceRootNameAtom) || undefined;
    const branchName = useAtomValue(currentBranchAtom) || undefined;
    const activeWorktree = useAtomValue(activeWorktreeAtom);

    const {
      workspaceLabel,
      isMultiRoot,
      aheadCount,
      behindCount,
      workingAdditions,
      workingDeletions,
      needsPublish,
      isSyncBusy,
      isPublishing,
      canSyncDisplayedRepo,
      syncSpinClass,
      syncStatusLabel,
      handleSyncClick,
      handleFetchClick,
      handlePullClick,
      handleRebaseClick,
      handlePushClick,
      checkoutLoading,
    } = useEditorStatusBarGit({ repoName, repoPath, branchName });

    const { isGitInitialized, refreshGitInitialization } =
      useRepoGitInitialization(repoPath);
    const [isInitializingGit, setIsInitializingGit] = useState(false);

    const handleInitializeGit = useCallback(async () => {
      if (!repoPath || isInitializingGit) return;

      setIsInitializingGit(true);
      try {
        await repoApi.importLocalRepo({ fs_path: repoPath });
        await refreshGitInitialization();
      } catch (error) {
        Message.error(
          error instanceof Error ? error.message : t("errors.unexpectedError")
        );
      } finally {
        setIsInitializingGit(false);
      }
    }, [isInitializingGit, repoPath, refreshGitInitialization, t]);

    const sessionRepoHint = useAtomValue(sessionRepoHintAtom);
    const setActiveFolderId = useSetAtom(activeFolderIdAtom);
    const { selectRepo } = useRepoSelection({ autoLoad: false });
    const handleSwitchToSessionRepo = useCallback(() => {
      if (!sessionRepoHint) return;
      if (sessionRepoHint.type === "folder") {
        setActiveFolderId(sessionRepoHint.folderId);
        return;
      }
      selectRepo(sessionRepoHint.repoId);
    }, [sessionRepoHint, selectRepo, setActiveFolderId]);
    const showGitControls = isGitInitialized === true;

    const leftContent = useMemo(
      () => (
        <EditorStatusBarLeft
          t={t}
          repoName={repoName}
          branchName={branchName}
          isGitInitialized={isGitInitialized}
          showGitControls={showGitControls}
          checkoutLoading={checkoutLoading}
          isMultiRoot={isMultiRoot}
          workspaceLabel={workspaceLabel}
          activeWorktree={activeWorktree}
          aheadCount={aheadCount}
          behindCount={behindCount}
          workingAdditions={workingAdditions}
          workingDeletions={workingDeletions}
          needsPublish={needsPublish}
          isSyncBusy={isSyncBusy}
          isPublishing={isPublishing}
          canSyncDisplayedRepo={canSyncDisplayedRepo}
          syncSpinClass={syncSpinClass}
          syncStatusLabel={syncStatusLabel}
          commitShortSha={commitInfo?.shortSha}
          sessionRepoHint={sessionRepoHint}
          onRepoClick={onRepoClick}
          onBranchClick={onBranchClick}
          onWorktreeClick={onWorktreeClick}
          onSyncClick={handleSyncClick}
          isInitializingGit={isInitializingGit}
          onInitializeGit={handleInitializeGit}
          onFetchClick={handleFetchClick}
          onPullClick={handlePullClick}
          onRebaseClick={handleRebaseClick}
          onPushClick={handlePushClick}
          onSwitchToSessionRepo={handleSwitchToSessionRepo}
        />
      ),
      [
        repoName,
        branchName,
        isGitInitialized,
        showGitControls,
        isInitializingGit,
        handleInitializeGit,
        checkoutLoading,
        needsPublish,
        isSyncBusy,
        isPublishing,
        canSyncDisplayedRepo,
        behindCount,
        aheadCount,
        workingAdditions,
        workingDeletions,
        commitInfo?.shortSha,
        onRepoClick,
        onBranchClick,
        onWorktreeClick,
        activeWorktree,
        handleSyncClick,
        handleFetchClick,
        handlePullClick,
        handleRebaseClick,
        handlePushClick,
        syncSpinClass,
        syncStatusLabel,
        isMultiRoot,
        workspaceLabel,
        sessionRepoHint,
        handleSwitchToSessionRepo,
        t,
      ]
    );

    const rightContent = useMemo(
      () => (
        <EditorStatusBarRight
          t={t}
          commitInfo={commitInfo}
          cursor={cursor}
          hasSelection={hasSelection}
          totalLines={totalLines}
        />
      ),
      [t, commitInfo, cursor, hasSelection, totalLines]
    );

    return (
      <BaseStatusBar
        leftContent={leftContent}
        rightContent={rightContent}
        className={className}
      />
    );
  }
);

EditorStatusBar.displayName = "EditorStatusBar";

export default EditorStatusBar;

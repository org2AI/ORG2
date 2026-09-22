/**
 * Commit controls rendered by `CommitSection`, once as the sidebar launcher
 * row (no message) and once inside the modal (with the message input).
 * Picks the primary action for the branch state: publish, commit & publish,
 * sync, or commit.
 */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import { CommitActionButtons } from "./CommitActionButtons";
import { CommitMessageField } from "./CommitMessageField";
import {
  CommitAndPublishButton,
  PublishBranchButton,
} from "./CommitPublishButtons";
import { CommitSyncControl } from "./CommitSyncControl";
import type { CommitControlsProps } from "./commitSectionTypes";

export const CommitControls: React.FC<CommitControlsProps> = memo(
  ({
    showMessage = true,
    commitMessage,
    onCommitMessageChange,
    branchName,
    onCommit,
    onCommitAndPush,
    onCommitAndPublish,
    onCommitAndSync,
    onAmend,
    commitLoading,
    canCommit,
    commitButtonText,
    onGenerateCommitMessage,
    generateCommitMessageLoading = false,
    isMerging,
    mergingBranch,
    hasUnresolvedConflicts,
    onContinueMerge,
    hasStagedFiles,
    hasUnstagedFiles,
    showPublishButton,
    showCommitAndPublishButton,
    commitAndPublishButtonText,
    onPublish,
    publishLoading,
    showSyncButton,
    onSync,
    syncLoading,
    onPull,
    pullLoading = false,
    onPush,
    pushLoading = false,
    onFetch,
    fetchLoading = false,
    ahead,
    behind,
  }) => {
    const { t } = useTranslation();

    // TODO: Re-enable when a reliable LLM provider is wired up
    const _onGenerateCommitMessage = onGenerateCommitMessage;
    const _generateCommitMessageLoading = generateCommitMessageLoading;

    const commitMessagePlaceholder = t("placeholders.commitMessage");
    const wrapperClass = showMessage ? "shrink-0" : "shrink-0 px-3 pb-2 pt-1";

    // Publish Branch button
    if (showPublishButton) {
      return (
        <div className={wrapperClass}>
          {showMessage && (
            <CommitMessageField
              placeholder={commitMessagePlaceholder}
              ariaLabel={commitMessagePlaceholder}
              value={commitMessage}
              onChange={onCommitMessageChange}
            />
          )}
          <PublishBranchButton
            branchName={branchName}
            onPublish={onPublish}
            publishLoading={publishLoading}
          />
        </div>
      );
    }

    if (showCommitAndPublishButton) {
      return (
        <div className={wrapperClass}>
          {showMessage && (
            <CommitMessageField
              placeholder={commitMessagePlaceholder}
              ariaLabel={commitMessagePlaceholder}
              value={commitMessage}
              onChange={onCommitMessageChange}
            />
          )}
          <CommitAndPublishButton
            canCommit={canCommit}
            commitAndPublishButtonText={commitAndPublishButtonText}
            commitLoading={commitLoading}
            hasStagedFiles={hasStagedFiles}
            hasUnstagedFiles={hasUnstagedFiles}
            onCommitAndPublish={onCommitAndPublish}
            publishLoading={publishLoading}
          />
        </div>
      );
    }

    // Sync Changes button (with dropdown for Pull, Push, Fetch)
    if (showSyncButton) {
      return (
        <div className={wrapperClass}>
          {showMessage && (
            <CommitMessageField
              placeholder={commitMessagePlaceholder}
              ariaLabel={commitMessagePlaceholder}
              value={commitMessage}
              onChange={onCommitMessageChange}
            />
          )}
          <CommitSyncControl
            ahead={ahead}
            behind={behind}
            fetchLoading={fetchLoading}
            onFetch={onFetch}
            onPull={onPull}
            onPush={onPush}
            onSync={onSync}
            pullLoading={pullLoading}
            pushLoading={pushLoading}
            syncLoading={syncLoading}
          />
        </div>
      );
    }

    // Commit section (default)
    return (
      <div className={wrapperClass}>
        {showMessage && (
          <CommitMessageField
            placeholder={
              isMerging && mergingBranch
                ? `Merge branch '${mergingBranch}' into ${branchName || "current"}`
                : commitMessagePlaceholder
            }
            ariaLabel={commitMessagePlaceholder}
            value={commitMessage}
            onChange={onCommitMessageChange}
          />
        )}
        <CommitActionButtons
          canCommit={canCommit}
          commitButtonText={commitButtonText}
          commitLoading={commitLoading}
          hasStagedFiles={hasStagedFiles}
          hasUnresolvedConflicts={hasUnresolvedConflicts}
          hasUnstagedFiles={hasUnstagedFiles}
          isMerging={isMerging}
          onAmend={onAmend}
          onCommit={onCommit}
          onCommitAndPublish={onCommitAndPublish}
          onCommitAndPush={onCommitAndPush}
          onCommitAndSync={onCommitAndSync}
          onContinueMerge={onContinueMerge}
          publishLoading={publishLoading}
          showMessage={showMessage}
        />
      </div>
    );
  }
);

CommitControls.displayName = "CommitControls";

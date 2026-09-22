/**
 * Props of `CommitSection` and the `CommitControls` it renders twice (the
 * sidebar launcher row and the modal with the message input).
 */
export interface CommitSectionProps {
  // Commit message
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  branchName?: string;

  // Commit actions
  onCommit: () => void;
  onCommitAndPush?: () => void;
  onCommitAndPublish?: () => void;
  onCommitAndSync?: () => void;
  onAmend?: () => void;
  commitLoading: boolean;
  canCommit: boolean;
  commitButtonText: string;

  // AI commit message generation
  onGenerateCommitMessage?: () => void;
  generateCommitMessageLoading?: boolean;

  // Merge state
  isMerging: boolean;
  mergingBranch?: string;
  hasUnresolvedConflicts: boolean;
  onContinueMerge?: () => void;

  // Staged/unstaged info for tooltips
  hasStagedFiles: boolean;
  hasUnstagedFiles: boolean;

  // Publish state
  showPublishButton: boolean;
  showCommitAndPublishButton: boolean;
  commitAndPublishButtonText: string;
  onPublish?: () => Promise<void>;
  publishLoading: boolean;

  // Sync state
  showSyncButton: boolean;
  onSync?: () => void;
  syncLoading: boolean;
  onPull?: () => void;
  pullLoading?: boolean;
  onPush?: () => void;
  pushLoading?: boolean;
  onFetch?: () => void;
  fetchLoading?: boolean;
  ahead: number;
  behind: number;
}

export type CommitControlsProps = CommitSectionProps & {
  showMessage?: boolean;
};

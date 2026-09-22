/**
 * Publish-side primary actions of `CommitControls`: publish the current
 * branch when it has no upstream, or commit and publish in one step.
 */
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { CloudUploadIcon, HugeiconsIcon } from "@src/icons";

import { GIT_LABELS } from "../config";

export function PublishBranchButton({
  branchName,
  onPublish,
  publishLoading,
}: {
  branchName?: string;
  onPublish?: () => Promise<void>;
  publishLoading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant="primary"
      size="small"
      className="w-full"
      onClick={onPublish}
      disabled={publishLoading}
      loading={publishLoading}
      title={`Publish branch "${branchName}" to origin`}
      data-action="git.publish"
      icon={
        publishLoading ? undefined : (
          <HugeiconsIcon
            icon={CloudUploadIcon}
            data-icon="cloud-upload"
            size={14}
            className="mr-1.5"
          />
        )
      }
    >
      {publishLoading ? (
        <span className="font-medium">{t("workstation.publishingBranch")}</span>
      ) : (
        <span className="flex max-w-full min-w-0 items-center justify-center">
          <span className="shrink-0">{GIT_LABELS.publish}</span>
          {branchName && (
            <span className="ml-1 min-w-0 truncate font-bold">
              {branchName}
            </span>
          )}
          <span className="ml-1 shrink-0">{t("workstation.toOrigin")}</span>
        </span>
      )}
    </Button>
  );
}

export function CommitAndPublishButton({
  canCommit,
  commitAndPublishButtonText,
  commitLoading,
  hasStagedFiles,
  hasUnstagedFiles,
  onCommitAndPublish,
  publishLoading,
}: {
  canCommit: boolean;
  commitAndPublishButtonText: string;
  commitLoading: boolean;
  hasStagedFiles: boolean;
  hasUnstagedFiles: boolean;
  onCommitAndPublish?: () => void;
  publishLoading: boolean;
}) {
  return (
    <Button
      variant="primary"
      size="small"
      className="w-full"
      onClick={onCommitAndPublish}
      disabled={!canCommit || !onCommitAndPublish}
      loading={commitLoading || publishLoading}
      title={
        !hasStagedFiles && hasUnstagedFiles
          ? `No staged changes. Will stage all changes, commit, and publish the branch (Smart Commit)`
          : "Commit changes and publish the branch"
      }
      data-action="git.commit.publish"
      icon={
        <HugeiconsIcon
          icon={CloudUploadIcon}
          data-icon="cloud-upload"
          size={14}
        />
      }
    >
      {commitAndPublishButtonText}
    </Button>
  );
}

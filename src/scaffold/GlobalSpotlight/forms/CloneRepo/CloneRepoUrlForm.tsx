/**
 * CloneUrlForm
 *
 * Form for cloning a repo from a GitHub URL
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import { CodeXmlIcon, HugeiconsIcon } from "@src/icons";
import { joinPathForDisplay } from "@src/util/file/pathUtils";

import { ICONS } from "../../config";
import {
  SpotlightFormBody,
  SpotlightFormShell,
  SpotlightModalHeader,
} from "../shared";
import { DirectoryPathField } from "../shared/DirectoryPathField";
import { SpotlightFormActions } from "../shared/SpotlightFormActions";
import { SpotlightFormField } from "../shared/SpotlightFormField";

interface CloneUrlFormProps {
  repoUrl: string;
  onRepoUrlChange: (url: string) => void;
  localPath: string;
  onLocalPathChange: (path: string) => void;
  onChoosePath: () => Promise<string | null>;
  onCancel: () => void;
  onSubmit: () => void;
  loading: boolean;
  hideHeader?: boolean;
}

const CloneUrlForm: React.FC<CloneUrlFormProps> = ({
  repoUrl,
  onRepoUrlChange,
  localPath,
  onLocalPathChange,
  onChoosePath,
  onCancel,
  onSubmit,
  loading,
  hideHeader = false,
}) => {
  const { t } = useTranslation();
  const isSubmitDisabled = loading || !repoUrl.trim() || !localPath.trim();

  const getStatusKey = (): string => {
    if (loading) return "statusCloningRepo";
    if (repoUrl && localPath) return "statusReadyToClone";
    if (repoUrl) return "statusSelectLocalPath";
    return "statusEnterGitHubUrl";
  };

  // Extract repo name from GitHub URL
  const getRepoNameFromUrl = (url: string): string | null => {
    try {
      // Handle various GitHub URL formats:
      // - https://github.com/owner/repo.git
      // - https://github.com/owner/repo
      // - github.com/owner/repo
      // - git@github.com:owner/repo.git
      const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/i);
      return match ? match[2] : null;
    } catch {
      return null;
    }
  };

  const repoName = getRepoNameFromUrl(repoUrl);

  return (
    <div className="flex h-full flex-col">
      <SpotlightModalHeader
        icon={ICONS.cloneRepo}
        title={t("cloneForm.titleCloneFromGitHubUrl")}
        badge="CLONE"
        badgeColor="primary"
        statusText={t(`cloneForm.${getStatusKey()}`)}
        isLoading={loading}
        onClose={onCancel}
        hideHeader={hideHeader}
      />
      <SpotlightFormShell>
        <SpotlightFormBody>
          <SpotlightFormField label={t("cloneForm.githubUrl")} className="mb-3">
            <Input
              placeholder={t("cloneForm.githubUrlPlaceholder")}
              value={repoUrl}
              onChange={onRepoUrlChange}
              className="h-[32px] rounded-lg text-[14px]"
              prefix={
                <HugeiconsIcon
                  icon={CodeXmlIcon}
                  data-icon="code"
                  className="text-[16px] text-text-2"
                  size={16}
                />
              }
            />
          </SpotlightFormField>
          <DirectoryPathField
            label={t("cloneForm.cloneTo")}
            value={localPath}
            onChange={onLocalPathChange}
            onChoosePath={onChoosePath}
            chooseLabel={t("cloneForm.chooseFolder")}
            placeholder={t("cloneForm.parentFolderPlaceholder")}
            disabled={loading}
            preview={
              localPath &&
              repoName && (
                <div className="mt-2 text-[12px] text-text-2">
                  {t("cloneForm.repoWillBeClonedTo")}{" "}
                  <span className="font-medium text-text-1">
                    {joinPathForDisplay(localPath, repoName)}
                  </span>
                </div>
              )
            }
          />
        </SpotlightFormBody>

        <SpotlightFormActions
          backLabel={t("actions.back")}
          onBack={onCancel}
          busy={loading}
          submit={{
            label: loading ? `${t("actions.clone")}...` : t("actions.clone"),
            onClick: onSubmit,
            disabled: isSubmitDisabled,
          }}
        />
      </SpotlightFormShell>
    </div>
  );
};

export default CloneUrlForm;

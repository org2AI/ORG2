/**
 * CloneGitHubForm
 *
 * Form for cloning a repo from connected GitHub accounts
 */
import React from "react";
import { useTranslation } from "react-i18next";

import type { GitHubRepo } from "@src/api/http/github/types";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { Placeholder } from "@src/components/Placeholder";
import Radio from "@src/components/Radio";
import { buildIntegrationsPath } from "@src/config/mainAppPaths";
import { useAppNavigate as useNavigate } from "@src/hooks/navigation/useAppNavigate";
import {
  FilterIcon,
  HugeiconsIcon,
  InternetIcon,
  LockIcon,
  SquareArrowUpRight02Icon,
} from "@src/icons";
import { ACTION_ID, useActionSystemOptional } from "@src/scaffold/ActionSystem";
import { joinPathForDisplay } from "@src/util/file/pathUtils";

import { ICONS } from "../../config";
import {
  SpotlightFormBody,
  SpotlightFormShell,
  SpotlightModalHeader,
} from "../shared";
import { DirectoryPathField } from "../shared/DirectoryPathField";
import { SpotlightFormActions } from "../shared/SpotlightFormActions";

interface CloneGitHubFormProps {
  filterText: string;
  onFilterTextChange: (text: string) => void;
  repositories: GitHubRepo[];
  groupedRepos: Array<{ organization: string; repositories: GitHubRepo[] }>;
  selectedRepo: string | null;
  onSelectRepo: (id: string | null) => void;
  localPath: string;
  onLocalPathChange: (path: string) => void;
  isLoadingRepos: boolean;
  onChoosePath: () => Promise<string | null>;
  onFetchRepos: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  loading: boolean;
  hideHeader?: boolean;
}

const CloneGitHubForm: React.FC<CloneGitHubFormProps> = ({
  filterText,
  onFilterTextChange,
  repositories,
  groupedRepos,
  selectedRepo,
  onSelectRepo,
  localPath,
  onLocalPathChange,
  isLoadingRepos,
  onChoosePath,
  onFetchRepos,
  onCancel,
  onSubmit,
  loading,
  hideHeader = false,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actionSystem = useActionSystemOptional();
  const isSubmitDisabled =
    loading || selectedRepo === null || !localPath.trim();

  const handleGoToSettings = () => {
    onCancel();
    if (actionSystem?.isValidAction(ACTION_ID.APP_GO_TO_CONNECTIONS)) {
      void actionSystem.dispatch(ACTION_ID.APP_GO_TO_CONNECTIONS, {}, "user");
      return;
    }
    navigate(buildIntegrationsPath({ category: "connections" }));
  };

  const getStatusKey = (): string => {
    if (loading) return "statusCloningRepo";
    if (isLoadingRepos) return "statusLoadingRepos";
    if (selectedRepo && localPath) return "statusReadyToClone";
    if (selectedRepo) return "statusSelectLocalPath";
    return "statusSelectRepo";
  };

  // Auto-fetch repos on mount
  React.useEffect(() => {
    if (repositories.length === 0 && !isLoadingRepos) {
      onFetchRepos();
    }
  }, [repositories.length, isLoadingRepos, onFetchRepos]);

  return (
    <div className="flex h-full flex-col">
      <SpotlightModalHeader
        icon={ICONS.cloneRepo}
        title={t("cloneForm.titleCloneFromMyGitHub")}
        badge="CLONE"
        badgeColor="primary"
        statusText={t(`cloneForm.${getStatusKey()}`)}
        isLoading={loading || isLoadingRepos}
        onClose={onCancel}
        hideHeader={hideHeader}
      />
      <SpotlightFormShell>
        <SpotlightFormBody>
          <div className="mb-3">
            <Input
              placeholder={t("cloneForm.filterReposPlaceholder")}
              value={filterText}
              onChange={onFilterTextChange}
              className="h-[32px] rounded-lg text-[14px]"
              prefix={
                <HugeiconsIcon
                  icon={FilterIcon}
                  data-icon="filter"
                  className="text-[16px] text-text-2"
                  size={16}
                />
              }
            />
          </div>

          <div className="spotlight-scrollable mb-3 max-h-[150px] overflow-y-auto">
            {isLoadingRepos ? (
              <div className="flex items-center justify-center py-4">
                <span className="text-[14px] text-text-2">
                  {t("cloneForm.loadingRepos")}
                </span>
              </div>
            ) : groupedRepos.length > 0 ? (
              groupedRepos.map((group) => (
                <div key={group.organization} className="mb-2">
                  <div className="mb-1 text-[12px] font-medium text-text-2 uppercase">
                    {group.organization}
                  </div>
                  <div className="space-y-1">
                    {group.repositories.map((repo) => (
                      <label
                        key={repo.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-fill-1"
                      >
                        <Radio
                          checked={selectedRepo === repo.id}
                          onChange={() => onSelectRepo(repo.id)}
                        />
                        <div className="flex items-center gap-2">
                          {repo.is_private ? (
                            <HugeiconsIcon
                              icon={LockIcon}
                              data-icon="lock"
                              className="text-[12px] text-text-2"
                              size={12}
                            />
                          ) : (
                            <HugeiconsIcon
                              icon={InternetIcon}
                              data-icon="globe"
                              className="text-[12px] text-text-2"
                              size={12}
                            />
                          )}
                          <span className="text-[14px]">{repo.full_name}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex min-h-[120px] flex-col items-center justify-center py-4">
                <Placeholder
                  variant={filterText ? "no-results" : "empty"}
                  title={
                    filterText
                      ? t("cloneForm.noReposFound")
                      : t("cloneForm.githubNotConnected")
                  }
                  subtitle={
                    filterText
                      ? t("cloneForm.noReposFoundMatching")
                      : t("cloneForm.connectGithubHintOption")
                  }
                />
              </div>
            )}
          </div>
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
              selectedRepo && (
                <div className="mt-2 text-[12px] text-text-2">
                  {t("cloneForm.repoWillBeClonedTo")}{" "}
                  <span className="font-medium text-text-1">
                    {joinPathForDisplay(
                      localPath,
                      repositories.find((repo) => repo.id === selectedRepo)
                        ?.name ?? ""
                    )}
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
          left={
            groupedRepos.length === 0 && !filterText ? (
              <Button
                icon={
                  <HugeiconsIcon
                    icon={SquareArrowUpRight02Icon}
                    data-icon="square-arrow-out-up-right"
                    size={14}
                  />
                }
                iconPosition="right"
                onClick={handleGoToSettings}
              >
                {t("integrations:git.connectGithub")}
              </Button>
            ) : null
          }
        />
      </SpotlightFormShell>
    </div>
  );
};

export default CloneGitHubForm;

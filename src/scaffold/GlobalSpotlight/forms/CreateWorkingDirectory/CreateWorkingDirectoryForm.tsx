/**
 * CreateWorkingDirectoryForm
 *
 * Form for creating a new local working directory.
 */
import React, { useEffect } from "react";
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

interface CreateWorkingDirectoryFormProps {
  directoryName: string;
  onDirectoryNameChange: (name: string) => void;
  parentDirectoryPath: string;
  onParentDirectoryPathChange: (path: string) => void;
  onChoosePath: () => Promise<string | null>;
  onCancel: () => void;
  onSubmit: () => void;
  loading: boolean;
  hideHeader?: boolean;
  initialPath?: string;
  initialName?: string;
}

const CreateWorkingDirectoryForm: React.FC<CreateWorkingDirectoryFormProps> = ({
  directoryName,
  onDirectoryNameChange,
  parentDirectoryPath,
  onParentDirectoryPathChange,
  onChoosePath,
  onCancel,
  onSubmit,
  loading,
  hideHeader = false,
  initialPath,
  initialName,
}) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (initialPath && !parentDirectoryPath) {
      onParentDirectoryPathChange(initialPath);
    }
    if (initialName && !directoryName) {
      onDirectoryNameChange(initialName);
    }
  }, [
    initialPath,
    initialName,
    parentDirectoryPath,
    directoryName,
    onParentDirectoryPathChange,
    onDirectoryNameChange,
  ]);

  const handleDirectoryNameChange = (value: string) => {
    const sanitized = value.replace(/\s+/g, "");
    onDirectoryNameChange(sanitized);
  };

  return (
    <div className="flex h-full flex-col">
      <SpotlightModalHeader
        icon={ICONS.newRepo}
        title={t("selectors.repo.forms.createWorkspaceTitle")}
        badge="CREATE"
        badgeColor="green"
        statusText={
          loading
            ? t("selectors.repo.forms.creatingWorkspace")
            : t("selectors.repo.forms.readyToCreateWorkspace")
        }
        isLoading={loading}
        onClose={onCancel}
        hideHeader={hideHeader}
      />
      <SpotlightFormShell>
        <SpotlightFormBody>
          <SpotlightFormField
            label={t("selectors.repo.forms.workspaceName")}
            className="mb-3"
          >
            <Input
              placeholder={t("selectors.repo.forms.workspaceNamePlaceholder")}
              value={directoryName}
              onChange={handleDirectoryNameChange}
              className="h-[32px] rounded-lg text-[14px]"
              prefix={
                <HugeiconsIcon
                  icon={CodeXmlIcon}
                  data-icon="code"
                  className="text-[16px] text-text-2"
                  size={16}
                />
              }
              autoCorrect="off"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </SpotlightFormField>
          <DirectoryPathField
            label={t("selectors.repo.forms.localPath")}
            value={parentDirectoryPath}
            onChange={onParentDirectoryPathChange}
            onChoosePath={onChoosePath}
            chooseLabel={t("selectors.repo.forms.choose")}
            placeholder={t("selectors.repo.forms.chooseDestinationPath")}
            disabled={loading}
            textAction
          />
        </SpotlightFormBody>

        <SpotlightFormActions
          backLabel={t("actions.cancel")}
          onBack={onCancel}
          busy={loading}
          submit={{
            label: loading ? `${t("actions.create")}...` : t("actions.create"),
            onClick: onSubmit,
            disabled: !directoryName.trim() || !parentDirectoryPath.trim(),
          }}
          left={
            parentDirectoryPath && directoryName ? (
              <span className="truncate text-[14px] text-text-1">
                {t("selectors.repo.forms.createAt", {
                  path: joinPathForDisplay(parentDirectoryPath, directoryName),
                })}
              </span>
            ) : undefined
          }
        />
      </SpotlightFormShell>
    </div>
  );
};

export default CreateWorkingDirectoryForm;

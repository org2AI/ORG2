/**
 * DeploymentModelInput Component
 *
 * Shown for gateway accounts (Azure OpenAI, vLLM) when model auto-detection
 * returns no results. Lets users manually enter deployment/model names that
 * are available on their endpoint.
 *
 * When onTestModel is provided, each model is tested via a lightweight
 * completion request before being added to the list.
 */
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import RefreshButton from "@src/components/Button/RefreshButton";
import Input from "@src/components/Input";
import PageNotice from "@src/components/PageNotice";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { Add01Icon, Cancel01Icon, HugeiconsIcon } from "@src/icons";

interface DeploymentModelInputProps {
  models: string[];
  onModelsChange: (models: string[]) => void;
  onTestModel?: (
    model: string
  ) => Promise<{ available: boolean; message: string }>;
  onRevalidate?: () => void;
  revalidating?: boolean;
  className?: string;
}

const DeploymentModelInput: React.FC<DeploymentModelInputProps> = ({
  models,
  onModelsChange,
  onTestModel,
  onRevalidate,
  revalidating = false,
  className = "",
}) => {
  const { t } = useTranslation("integrations");
  const [draft, setDraft] = useState("");
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const addModel = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || models.includes(trimmed)) return;
      onModelsChange([...models, trimmed]);
    },
    [models, onModelsChange]
  );

  const handleAdd = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || models.includes(trimmed)) return;

    setTestError(null);

    if (onTestModel) {
      setTesting(true);
      try {
        const result = await onTestModel(trimmed);
        if (!result.available) {
          setTestError(result.message);
          return;
        }
      } catch {
        setTestError("Failed to test model");
        return;
      } finally {
        setTesting(false);
      }
    }

    addModel(trimmed);
    setDraft("");
  }, [draft, models, addModel, onTestModel]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleAdd();
      }
    },
    [handleAdd]
  );

  const handleRemove = useCallback(
    (index: number) => {
      onModelsChange(models.filter((_, idx) => idx !== index));
    },
    [models, onModelsChange]
  );

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {!noticeDismissed && (
        <PageNotice type="info" onClose={() => setNoticeDismissed(true)}>
          {t("keyVault.deploymentModels.description")}
        </PageNotice>
      )}

      <div className="rounded-lg border border-border-2 bg-bg-1">
        {models.length > 0 && (
          <div className="flex flex-col gap-1 p-2">
            {models.map((model, index) => (
              <div
                key={model}
                className="flex items-center gap-2 rounded-md bg-fill-1 px-3 py-1.5"
              >
                <span className="flex-1 truncate text-[12px] text-text-1">
                  {model}
                </span>
                <Button
                  variant="tertiary"
                  tone="danger"
                  size="sidebar"
                  iconOnly
                  icon={
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      data-icon="x"
                      size={HEADER_ICON_SIZE.sm}
                    />
                  }
                  onClick={() => handleRemove(index)}
                  aria-label={`${t("common:actions.delete")} ${model}`}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-border-2 p-2">
          <div className="flex-1" onKeyDown={handleKeyDown}>
            <Input
              value={draft}
              onChange={setDraft}
              placeholder={t("keyVault.deploymentModels.placeholder")}
              size="small"
            />
          </div>
          <Button
            size="small"
            onClick={handleAdd}
            disabled={!draft.trim() || testing}
            loading={testing}
            icon={<HugeiconsIcon icon={Add01Icon} data-icon="plus" size={14} />}
          >
            {t("keyVault.deploymentModels.addModel")}
          </Button>
        </div>
      </div>

      {testError && (
        <PageNotice type="danger" onClose={() => setTestError(null)}>
          {testError}
        </PageNotice>
      )}

      {onRevalidate && models.length > 0 && (
        <RefreshButton
          variant="secondary"
          size="small"
          label={t("keyVault.revalidate")}
          refreshing={revalidating}
          onRefresh={onRevalidate}
        />
      )}
    </div>
  );
};

export default DeploymentModelInput;

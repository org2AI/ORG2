import React, { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import ModelIcon from "@src/components/ModelIcon";
import ModelSelectorPillView from "@src/components/ModelSelectorPill/ModelSelectorPillView";
import SelectorPill from "@src/components/SelectorPill";
import type {
  MobileModelOption,
  MobileSessionModelConfig,
} from "@src/modules/MobileRemote/connection/types";
import {
  formatModelName,
  formatModelNameFull,
  resolveModelFullLabel,
  resolveModelPillDisplayParts,
} from "@src/util/formatModelName";

import { MobileModelListDropdown } from "./MobileModelListDropdown";
import {
  collapseMobileModelOptions,
  mobileModelOptionsShareFamily,
} from "./collapseMobileModelOptions";
import {
  toMobileLastModelSelection,
  useMobileModelEffortSegment,
} from "./useMobileModelEffortSegment";

export interface MobileModelPickerProps {
  config: MobileSessionModelConfig | null;
  options: MobileModelOption[];
  loading?: boolean;
  optionsLoading?: boolean;
  error?: string;
  onActivate?: () => void;
  onRetry?: () => void;
  patching?: boolean;
  disabled?: boolean;
  /** When true, render inline in the composer footer without outer padding. */
  embedded?: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (option: MobileModelOption) => void | Promise<void>;
}

function formatModelLabel(modelId?: string): string {
  if (!modelId?.trim()) return "";
  return formatModelName(modelId) || formatModelNameFull(modelId) || modelId;
}

function resolveOptionForModelId(
  options: MobileModelOption[],
  config: MobileSessionModelConfig,
  modelId: string
): MobileModelOption {
  const match = options.find(
    (option) =>
      option.id === modelId && option.accountId === (config.accountId ?? "")
  );
  if (match) return match;
  return {
    id: modelId,
    accountId: config.accountId ?? "",
    accountLabel:
      options.find((option) => option.accountId === (config.accountId ?? ""))
        ?.accountLabel ?? "",
  };
}

export function MobileModelPicker({
  config,
  options,
  loading = false,
  optionsLoading = false,
  error,
  onActivate,
  onRetry,
  patching = false,
  disabled = false,
  embedded = false,
  open,
  onOpen,
  onClose,
  onSelect,
}: MobileModelPickerProps) {
  const { t } = useTranslation("mobileRemote");
  const pillRef = useRef<HTMLButtonElement>(null);

  const currentModelId = config?.model;
  const currentLabel = useMemo(
    () => formatModelLabel(currentModelId) || t("modelPicker.selectModel"),
    [currentModelId, t]
  );

  const editable = config?.modelEditable === true && !disabled;
  const selection = useMemo(
    () => (config ? toMobileLastModelSelection(config) : null),
    [config]
  );
  const defaultLabel = loading
    ? t("modelPicker.loading")
    : t("modelPicker.selectModel");
  const modelLabel = useMemo(() => {
    const displayParts = resolveModelPillDisplayParts(
      selection ?? {},
      defaultLabel
    );
    return {
      label: displayParts.label,
      title: resolveModelFullLabel(selection ?? {}, defaultLabel),
      accountName: options.find(
        (option) => option.accountId === config?.accountId
      )?.accountLabel,
      displayParts,
    };
  }, [selection, defaultLabel, options, config?.accountId]);
  const pickerDisabled = disabled || loading || patching;

  const listOptions = useMemo(
    () => collapseMobileModelOptions(options),
    [options]
  );

  const handleVariantApply = useCallback(
    (nextModelId: string) => {
      if (!config || pickerDisabled) return;
      if (nextModelId === currentModelId) return;
      void Promise.resolve(
        onSelect(resolveOptionForModelId(options, config, nextModelId))
      );
    },
    [config, currentModelId, onSelect, options, pickerDisabled]
  );

  const effortSegment = useMobileModelEffortSegment(
    config,
    options,
    editable && !pickerDisabled ? handleVariantApply : undefined
  );

  const handleOpenModelList = useCallback(() => {
    if (pickerDisabled) return;
    onOpen();
  }, [onOpen, pickerDisabled]);

  const handleSelectOption = useCallback(
    (option: MobileModelOption) => {
      if (patching) return;
      const sameAccount = option.accountId === (config?.accountId ?? "");
      if (
        sameAccount &&
        currentModelId &&
        mobileModelOptionsShareFamily(options, currentModelId, option.id)
      ) {
        onClose();
        return;
      }
      void Promise.resolve(onSelect(option)).finally(() => onClose());
    },
    [config?.accountId, currentModelId, onClose, onSelect, options, patching]
  );

  const triggerWrapperClass = embedded ? "min-w-0 max-w-full" : "px-1 pb-1";

  if (!config || !editable) {
    if (!currentModelId) return null;
    const readOnlyPill = (
      <SelectorPill
        icon={<ModelIcon modelName={currentModelId} size={14} />}
        label={currentLabel}
        size="sm"
        className="mobile-composer-model-trigger"
        active={false}
        disabled
        ariaLabel={currentLabel}
      />
    );
    return embedded ? (
      readOnlyPill
    ) : (
      <div className={triggerWrapperClass}>{readOnlyPill}</div>
    );
  }

  return (
    <>
      <div
        className={triggerWrapperClass}
        data-testid="mobile-model-picker-trigger"
        // Observe intent on the shared button, including its advanced menu.
        onPointerDownCapture={onActivate}
        onFocusCapture={onActivate}
      >
        <ModelSelectorPillView
          ref={pillRef}
          displaySelection={selection}
          modelLabel={modelLabel}
          defaultLabel={defaultLabel}
          active={open}
          onClick={handleOpenModelList}
          effortSegment={effortSegment}
          preferCombinedSettingsMenu
          settingsMenuDefaultAdvanced
          settingsMenuClassName="mobile-model-settings-menu"
          dataTestId="mobile-model-picker-pill"
          triggerClassName="mobile-composer-model-trigger"
          ariaLabel={t("modelPicker.selectModel")}
          className={`max-w-full ${pickerDisabled ? "pointer-events-none opacity-60" : ""}`}
        />
      </div>
      <MobileModelListDropdown
        anchorRef={pillRef}
        open={open}
        onClose={onClose}
        options={listOptions}
        allOptions={options}
        currentModelId={currentModelId}
        currentAccountId={config.accountId}
        loading={loading || optionsLoading}
        patching={patching}
        error={error}
        onRetry={onRetry}
        retryLabel={t("transcript.retry")}
        loadingLabel={t("modelPicker.loading")}
        emptyLabel={t("modelPicker.empty")}
        onSelect={handleSelectOption}
      />
    </>
  );
}

MobileModelPicker.displayName = "MobileModelPicker";

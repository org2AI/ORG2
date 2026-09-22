/**
 * ModelSelectorPill
 *
 * Shared model selector trigger used by the active chat input and the
 * SessionCreator input. Models with selectable effort use one combined pill
 * and settings menu, or a model pill plus a separate effort pill when
 * `separateEffortPill` is set. Other models retain their existing PillGroup
 * control.
 */
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { PILL_SM_ICON_SIZE } from "@src/components/CompoundPill/config";
import ModelIcon from "@src/components/ModelIcon";
import ModelPillTooltipContent from "@src/components/ModelPillTooltipContent";
import ModelPropertiesDropdown from "@src/components/ModelPropertiesDropdown";
import PillGroup, { type PillGroupSegment } from "@src/components/PillGroup";
import SelectorPill, {
  type SelectorPillPaddingX,
} from "@src/components/SelectorPill";
import Tooltip from "@src/components/Tooltip";
import type { ModelEffortSegmentState } from "@src/hooks/models/useModelEffortSegment";
import { AiSettingIcon, FlashIcon, HugeiconsIcon } from "@src/icons";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";
import {
  type ModelPillDisplayParts,
  formatModelNameFull,
} from "@src/util/formatModelName";
import {
  MODEL_REASONING_LEVEL,
  formatReasoningLevel,
} from "@src/util/modelVariants";

import ModelSettingsMenu, {
  type HarnessSwitchAction,
} from "./ModelSettingsMenu";

/** Tone for a reasoning-level label: Ultra stays purple, open reads primary. */
function levelToneClass(level: string | undefined, open: boolean): string {
  if (level === MODEL_REASONING_LEVEL.ULTRA) return "text-purple-6";
  return open ? "text-primary-6" : "text-text-3";
}

export interface ModelSelectorPillViewProps {
  /** Resolved by the owning runtime; this view never reads a local key vault. */
  displaySelection: LastModelSelection | null | undefined;
  modelLabel: {
    label: string;
    title: string;
    accountName?: string;
    displayParts: ModelPillDisplayParts;
  };
  effortSegment: ModelEffortSegmentState;
  harnessSwitch?: HarnessSwitchAction;
  defaultLabel: string;
  active: boolean;
  onClick: () => void;
  className?: string;
  /** Classes applied to the trigger button (not the PillGroup wrapper). */
  triggerClassName?: string;
  /** Drop left padding on the trigger so the icon lines up with editor text. */
  triggerLeadingFlush?: boolean;
  /** Horizontal spacing shared by the model and effort triggers. */
  paddingX?: SelectorPillPaddingX;
  dataTestId?: string;
  effortDataTestId?: string;
  ariaLabel?: string;
  iconSize?: number;
  /** Mobile opens the detailed Effort/Speed menu instead of the slider. */
  settingsMenuDefaultAdvanced?: boolean;
  /** Portal surface styling for constrained hosts such as Mobile Remote. */
  settingsMenuClassName?: string;
  /** Compatibility option; all enabled model pills now use the combined menu. */
  preferCombinedSettingsMenu?: boolean;
  /**
   * Split effort into its own pill: the model pill then opens the model
   * picker directly and the effort pill owns the settings menu.
   */
  separateEffortPill?: boolean;
  /** Prevent opening a picker while its execution inventory is unresolved. */
  disabled?: boolean;
  /** Explanation shown on hover or focus while the picker is disabled. */
  disabledTooltip?: string;
}

const ModelSelectorPillView = forwardRef<
  HTMLButtonElement,
  ModelSelectorPillViewProps
>(
  (
    {
      displaySelection,
      modelLabel: resolvedLabel,
      effortSegment,
      harnessSwitch,
      defaultLabel,
      active,
      onClick,
      className,
      triggerClassName,
      triggerLeadingFlush = false,
      paddingX = "standard",
      dataTestId,
      effortDataTestId = "chat-model-pill-effort",
      ariaLabel,
      iconSize = PILL_SM_ICON_SIZE,
      settingsMenuDefaultAdvanced = false,
      settingsMenuClassName,
      disabled = false,
      disabledTooltip,
      separateEffortPill = false,
    },
    ref
  ) => {
    const modelSegmentRef = useRef<HTMLButtonElement>(null);
    const effortPillRef = useRef<HTMLButtonElement>(null);
    useImperativeHandle(
      ref,
      () => modelSegmentRef.current as HTMLButtonElement
    );

    const [effortOpen, setEffortOpen] = useState(false);
    const [disabledTooltipOpen, setDisabledTooltipOpen] = useState(false);

    const {
      label: modelLabel,
      title: modelTitle,
      accountName,
      displayParts,
    } = resolvedLabel;

    const modelIconName = useMemo(
      () =>
        displaySelection?.listingModel || displaySelection?.model || undefined,
      [displaySelection]
    );
    const modelIconAgent = useMemo(
      () =>
        displaySelection?.listingModelType ??
        displaySelection?.selectedSourceModelType,
      [displaySelection]
    );
    const hasModelSelection = Boolean(modelIconName);

    const resolvedModelLabel = useMemo(() => {
      if (!modelIconName) return modelLabel;
      if (modelLabel && modelLabel !== modelIconName) return modelLabel;
      return formatModelNameFull(modelIconName) || modelLabel || defaultLabel;
    }, [defaultLabel, modelIconName, modelLabel]);

    const {
      editable: effortEditable,
      effortLabel,
      effortAriaLabel,
      modelId: effortModelId,
      variantOptions,
      handleApply: handleEffortApply,
    } = effortSegment;

    const variant = useMemo(
      () =>
        effortModelId
          ? variantOptions.parseSelection(effortModelId)
          : undefined,
      [effortModelId, variantOptions]
    );

    const handleEffortOpenChange = useCallback((open: boolean) => {
      setEffortOpen(open);
    }, []);

    const modelIcon = useMemo(
      () =>
        hasModelSelection ? (
          <ModelIcon
            modelName={modelIconName}
            agentType={modelIconAgent}
            size={iconSize}
          />
        ) : (
          <HugeiconsIcon
            icon={AiSettingIcon}
            data-icon="ai-setting"
            size={iconSize}
            strokeWidth={1.75}
            className="text-primary-6"
          />
        ),
      [hasModelSelection, iconSize, modelIconAgent, modelIconName]
    );

    const modelTooltip = useMemo(
      () =>
        disabled ? undefined : (
          <ModelPillTooltipContent
            accountName={accountName}
            modelLabel={displayParts.rawValue ?? displayParts.label}
            modelId={modelIconName}
            modelType={modelIconAgent}
            variantInfo={
              displayParts.rawValue ? undefined : displayParts.variantInfo
            }
            thinking={displayParts.rawValue ? false : displayParts.thinking}
            shortcutId={"open_model_selector"}
          />
        ),
      [
        accountName,
        disabled,
        displayParts.label,
        displayParts.rawValue,
        displayParts.thinking,
        displayParts.variantInfo,
        modelIconAgent,
        modelIconName,
      ]
    );

    const segments = useMemo((): PillGroupSegment[] => {
      const modelSegment: PillGroupSegment = {
        id: "model",
        icon: modelIcon,
        label: resolvedModelLabel,
        title: modelTitle,
        tooltip: modelTooltip,
        tooltipFramed: true,
        tooltipFramedWide: true,
        ariaLabel: ariaLabel ?? defaultLabel,
        active,
        danger: !disabled && !hasModelSelection,
        disabled,
        onClick,
        dataTestId: dataTestId,
        buttonRef: modelSegmentRef,
        maxLabelWidth: 220,
        leadingFlush: triggerLeadingFlush,
      };

      if (disabled || !effortEditable || !effortModelId) {
        return [modelSegment];
      }

      const effortSegment: PillGroupSegment = {
        id: "effort",
        icon: null,
        label: effortLabel,
        title: effortLabel,
        tooltip: effortAriaLabel,
        ariaLabel: effortAriaLabel,
        active: effortOpen,
        dataTestId: effortDataTestId,
        maxLabelWidth: 140,
        renderButton: (buttonProps) =>
          separateEffortPill ? (
            <ModelSettingsMenu
              anchorRef={effortPillRef}
              modelLabel={resolvedModelLabel}
              value={effortModelId}
              harnessSwitch={harnessSwitch}
              variantOptions={variantOptions}
              onModelClick={onClick}
              onChange={handleEffortApply}
              onOpenChange={handleEffortOpenChange}
              defaultAdvanced={settingsMenuDefaultAdvanced}
              className={settingsMenuClassName}
              renderTrigger={({ open, onClick: openMenu, previewLevel }) => {
                const shownLevel = previewLevel ?? variant?.level;
                const levelLabel = shownLevel
                  ? formatReasoningLevel(shownLevel)
                  : effortLabel;
                return (
                  <SelectorPill
                    ref={effortPillRef}
                    icon={
                      variant?.fast ? (
                        <HugeiconsIcon
                          icon={FlashIcon}
                          data-icon="fast"
                          size={iconSize}
                        />
                      ) : null
                    }
                    textOnly={!variant?.fast}
                    label={levelLabel}
                    labelContent={
                      <span className={levelToneClass(shownLevel, open)}>
                        {levelLabel}
                      </span>
                    }
                    tooltip={effortAriaLabel}
                    active={buttonProps.active || open}
                    ariaExpanded={open}
                    ariaLabel={`${effortAriaLabel}${variant?.fast ? " · Fast" : ""}`}
                    // Label-only segment: even inset on both sides instead of
                    // the compact icon-led inset the model segment uses.
                    className={`${buttonProps.segmentClassName ?? ""} px-2!`}
                    labelClassName="font-normal"
                    onClick={openMenu}
                    onMouseDown={buttonProps.onMouseDown}
                    onMouseEnter={buttonProps.onMouseEnter}
                    onMouseLeave={buttonProps.onMouseLeave}
                    onFocus={buttonProps.onFocus}
                    onBlur={buttonProps.onBlur}
                    dataTestId={effortDataTestId}
                    labelStyle={{ maxWidth: 140 }}
                    size="sm"
                    paddingX={buttonProps.paddingX}
                  />
                );
              }}
            />
          ) : (
            <ModelPropertiesDropdown
              variantOptions={variantOptions}
              value={effortModelId}
              onChange={handleEffortApply}
              onOpenChange={handleEffortOpenChange}
              renderTrigger={({
                ref: triggerRef,
                onClick: openEffort,
                ariaExpanded,
              }) => (
                <SelectorPill
                  ref={triggerRef}
                  icon={null}
                  textOnly
                  label={effortLabel}
                  title={effortLabel}
                  tooltip={effortAriaLabel}
                  active={buttonProps.active || ariaExpanded}
                  className={buttonProps.segmentClassName}
                  labelClassName="text-[11px] font-normal text-text-2"
                  onClick={openEffort}
                  onMouseDown={buttonProps.onMouseDown}
                  onMouseEnter={buttonProps.onMouseEnter}
                  onMouseLeave={buttonProps.onMouseLeave}
                  onFocus={buttonProps.onFocus}
                  onBlur={buttonProps.onBlur}
                  dataTestId={effortDataTestId}
                  ariaLabel={effortAriaLabel}
                  labelStyle={{ maxWidth: 140 }}
                  size="sm"
                  paddingX={buttonProps.paddingX}
                />
              )}
            />
          ),
      };

      return [modelSegment, effortSegment];
    }, [
      active,
      ariaLabel,
      dataTestId,
      defaultLabel,
      disabled,
      effortAriaLabel,
      effortDataTestId,
      effortEditable,
      effortLabel,
      effortModelId,
      effortOpen,
      handleEffortApply,
      handleEffortOpenChange,
      harnessSwitch,
      hasModelSelection,
      iconSize,
      modelIcon,
      modelTitle,
      modelTooltip,
      onClick,
      resolvedModelLabel,
      separateEffortPill,
      settingsMenuClassName,
      settingsMenuDefaultAdvanced,
      triggerLeadingFlush,
      variant,
      variantOptions,
    ]);

    if (!disabled && !separateEffortPill) {
      return (
        <ModelSettingsMenu
          anchorRef={modelSegmentRef}
          modelLabel={resolvedModelLabel}
          value={effortModelId}
          harnessSwitch={harnessSwitch}
          showVariantControls={effortEditable}
          variantOptions={variantOptions}
          onModelClick={onClick}
          onChange={handleEffortApply}
          defaultAdvanced={settingsMenuDefaultAdvanced}
          className={settingsMenuClassName}
          renderTrigger={({ open, onClick: openMenu, previewLevel }) => {
            // While the effort slider is dragged the pill reports the level
            // under the thumb, so the panel is not the only place showing
            // where the gesture has landed. It falls back to the saved level
            // the moment the gesture ends.
            const shownLevel = previewLevel ?? variant?.level;
            const levelLabel = shownLevel
              ? formatReasoningLevel(shownLevel)
              : effortEditable
                ? effortLabel
                : "";
            const combinedLabel = [resolvedModelLabel, levelLabel]
              .filter(Boolean)
              .join(" ");
            return (
              <SelectorPill
                ref={modelSegmentRef}
                icon={
                  variant?.fast ? (
                    <HugeiconsIcon
                      icon={FlashIcon}
                      data-icon="fast"
                      size={iconSize}
                    />
                  ) : (
                    modelIcon
                  )
                }
                label={combinedLabel}
                labelContent={
                  <>
                    <span className="truncate font-medium">
                      {resolvedModelLabel}
                    </span>
                    {levelLabel && (
                      <span
                        className={`ml-1.5 shrink-0 font-normal ${levelToneClass(shownLevel, open)}`}
                      >
                        {levelLabel}
                      </span>
                    )}
                  </>
                }
                title={modelTitle}
                tooltip={modelTooltip}
                tooltipFramed
                tooltipFramedWide
                active={active || open}
                activeTone="neutral"
                // Before a model is picked the menu has nothing to edit, so
                // the pill opens the model picker itself and owns no popup.
                ariaExpanded={hasModelSelection ? open : undefined}
                ariaLabel={`${ariaLabel ?? defaultLabel}: ${combinedLabel}${variant?.fast ? " · Fast" : ""}`}
                dataTestId={dataTestId}
                className={`shrink-0 ${triggerClassName ?? ""} ${className ?? ""}`}
                leadingFlush={triggerLeadingFlush}
                paddingX={paddingX}
                onClick={hasModelSelection ? openMenu : onClick}
              />
            );
          }}
        />
      );
    }

    const pill = (
      <PillGroup
        segments={segments}
        paddingX={paddingX}
        className={`shrink-0 text-[13px] ${className ?? ""}`}
        segmentClassName={`h-[28px] ${disabled ? "cursor-not-allowed [&>span]:opacity-50" : ""} ${triggerClassName ?? ""}`.trim()}
      />
    );

    if (disabled && disabledTooltip) {
      return (
        <Tooltip
          content={disabledTooltip}
          position="top"
          open={disabledTooltipOpen}
          onOpenChange={setDisabledTooltipOpen}
        >
          <span
            tabIndex={0}
            onFocus={() => setDisabledTooltipOpen(true)}
            onBlur={() => setDisabledTooltipOpen(false)}
            aria-label={`${ariaLabel ?? defaultLabel}: ${disabledTooltip}`}
            aria-disabled="true"
            className="inline-flex min-w-0 cursor-not-allowed"
          >
            {pill}
          </span>
        </Tooltip>
      );
    }

    return pill;
  }
);

ModelSelectorPillView.displayName = "ModelSelectorPillView";

export default ModelSelectorPillView;

/**
 * ModelVariantInlineCard
 *
 * Variant controls for one model family on one key. Interactive callers get a
 * single row — effort slider, speed toggle, options dropdown, and the saved
 * selection read out at the right end. Read-only callers (the model catalog)
 * get the plain effort x speed grid.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/exports";
import { EffortSlider } from "@src/components/ModelPropertiesDropdown/EffortSlider";
import Tooltip from "@src/components/Tooltip";
import { InlineInfoCard } from "@src/components/layout/blocks";
import { ArrowDown01Icon, FlashIcon, HugeiconsIcon } from "@src/icons";
import type { ModelTableVariantInfo } from "@src/types/modelTable";
import { resolveDefaultVariant } from "@src/util/defaultModelVariant";
import { formatModelNameFull } from "@src/util/formatModelName";
import {
  formatVariantDisplayLabel,
  resolveModelVariantFields,
} from "@src/util/modelVariants";
import {
  type VariantSelection,
  buildVariantEditOptions,
} from "@src/util/variantEditOptions";

import ModelVariantGrid, { sortVariantsForDisplay } from "./ModelVariantGrid";

/** Keeps the slider readable without stretching across a wide row. */
const EFFORT_SLIDER_WIDTH = "w-[168px]";

/** Speed flavour, spelled the way the variant pills spell it. */
const FAST_LABEL = "Fast";

/** Shared surface for the row's pill controls (options trigger, speed). */
const PILL_CLASS =
  "inline-flex h-[28px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] hover:bg-fill-2";

interface ModelVariantInlineCardProps {
  variants: ModelTableVariantInfo[];
  forceModelList?: boolean;
  /** Skip the InlineInfoCard wrapper when already inside an InlineInfoCard. */
  embedded?: boolean;
  /**
   * Persisted default variant per base model (`base_model` → variant `model`).
   * When provided alongside {@link onChangeDefaultVariant}, the interactive
   * controls replace the plain grid.
   */
  defaultVariantByBaseModel?: Map<string, string>;
  /** Persist a new default variant for `baseModel`. */
  onChangeDefaultVariant?: (baseModel: string, model: string) => void;
}

export default function ModelVariantInlineCard({
  variants,
  forceModelList = false,
  embedded = false,
  defaultVariantByBaseModel,
  onChangeDefaultVariant,
}: ModelVariantInlineCardProps) {
  const { t } = useTranslation("integrations");
  const [optionsOpen, setOptionsOpen] = useState(false);

  const sortedVariants = useMemo(
    () => sortVariantsForDisplay(variants, forceModelList),
    [variants, forceModelList]
  );

  // A card always renders one model family, so the whole family collapses to a
  // single saved selection. We pick the shortest `base_model` string from the
  // complete family as the persistence key: filtering selectable efforts must
  // not change that key (the o4-mini bare record owns the existing o4 key),
  // and the unsuffixed and parsed spellings of a model must resolve to one
  // entry.
  const canonicalBaseModel =
    variants.length > 0
      ? variants
          .map(
            (variant) =>
              resolveModelVariantFields(variant.model, variant).base_model
          )
          .reduce((shortest, candidate) =>
            candidate.length < shortest.length ? candidate : shortest
          )
      : undefined;

  const persistedSelected =
    canonicalBaseModel && sortedVariants.length > 0
      ? (resolveDefaultVariant(
          canonicalBaseModel,
          sortedVariants,
          defaultVariantByBaseModel?.get(canonicalBaseModel)
        ) ?? sortedVariants[0].model)
      : undefined;

  const variantOptions = useMemo(
    () =>
      buildVariantEditOptions(sortedVariants.map((variant) => variant.model)),
    [sortedVariants]
  );

  const interactive =
    !forceModelList &&
    onChangeDefaultVariant !== undefined &&
    canonicalBaseModel !== undefined &&
    persistedSelected !== undefined;

  const handlePick = (modelId: string) => {
    if (!canonicalBaseModel) return;
    onChangeDefaultVariant?.(canonicalBaseModel, modelId);
  };

  const grid = (
    <ModelVariantGrid
      variants={sortedVariants}
      forceModelList={forceModelList}
      selectedModel={interactive ? persistedSelected : undefined}
      onPick={interactive ? handlePick : undefined}
    />
  );

  if (!interactive) {
    if (embedded) return grid;
    return (
      <InlineInfoCard>
        <div className="flex min-w-0 flex-col gap-3">{grid}</div>
      </InlineInfoCard>
    );
  }

  const selection = variantOptions.parseSelection(persistedSelected);
  const effortLevels = variantOptions.availableLevels;
  const fastToggleable =
    variantOptions.fastAvailableAnywhere &&
    variantOptions.fastAvailable(selection);

  const applySelection = (next: VariantSelection) => {
    // A level with no fast flavour clears Fast instead of resolving to an id
    // the family does not have.
    const normalized = {
      ...next,
      fast: next.fast && variantOptions.fastAvailable(next),
    };
    const modelId = variantOptions.resolveVariantId(normalized);
    if (!modelId || modelId === persistedSelected) return;
    onChangeDefaultVariant?.(canonicalBaseModel, modelId);
  };

  const optionsLabel = t("modelsTable.showVersionDetails");
  const selectedLabel =
    formatVariantDisplayLabel(persistedSelected) ??
    formatModelNameFull(persistedSelected);

  return (
    <div className="flex min-w-0 items-center justify-end gap-3">
      <Dropdown
        trigger="click"
        position="bottom-end"
        popupVisible={optionsOpen}
        onVisibleChange={setOptionsOpen}
        // The row lives inside a card that clips its overflow and scrolls, so
        // an inline panel would be cut off by both. Portal it to the body and
        // let it flip when it runs out of room.
        getPopupContainer={() => document.body}
        avoidViewportOverflow
        droplist={
          <div className={`${DROPDOWN_CLASSES.panel} min-w-[260px] px-3 py-2`}>
            {grid}
          </div>
        }
      >
        <Button
          layout="custom"
          aria-label={optionsLabel}
          aria-expanded={optionsOpen}
          className={`${PILL_CLASS} max-w-[160px] border-border-2 text-text-2`}
        >
          <span className="truncate">{selectedLabel}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            data-icon="chevron-down"
            size={12}
            className="shrink-0 text-text-3"
          />
        </Button>
      </Dropdown>
      <span className="h-4 w-px shrink-0 bg-border-2" aria-hidden="true" />
      {effortLevels.length > 1 ? (
        <div className={`${EFFORT_SLIDER_WIDTH} shrink-0`}>
          <EffortSlider
            levels={effortLevels}
            value={selection.level}
            onChange={(level) => applySelection({ ...selection, level })}
            fast={selection.fast}
            showLabel={false}
          />
        </div>
      ) : null}
      {fastToggleable ? (
        <Tooltip content={FAST_LABEL} position="top">
          <Button
            layout="custom"
            aria-label={FAST_LABEL}
            aria-pressed={selection.fast}
            onClick={() =>
              applySelection({ ...selection, fast: !selection.fast })
            }
            className={`inline-flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-lg border hover:bg-fill-2 ${
              selection.fast
                ? "border-primary-6 text-primary-6"
                : "border-border-2 text-text-2"
            }`}
          >
            <HugeiconsIcon icon={FlashIcon} data-icon="zap" size={14} />
          </Button>
        </Tooltip>
      ) : null}
    </div>
  );
}

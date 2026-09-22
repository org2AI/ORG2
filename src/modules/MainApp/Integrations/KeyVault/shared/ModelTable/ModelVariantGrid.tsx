/**
 * ModelVariantGrid
 *
 * The effort x speed matrix for one model family: a row per reasoning level,
 * a pill per speed/thinking flavour. Rendered inline for read-only catalog
 * rows, and inside the options dropdown where a key's default variant is
 * picked.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import ModelIcon from "@src/components/ModelIcon";
import Tooltip from "@src/components/Tooltip";
import type { ModelTableVariantInfo } from "@src/types/modelTable";
import { formatModelNameFull } from "@src/util/formatModelName";
import {
  MODEL_REASONING_LEVEL,
  type ModelReasoningLevel,
  formatReasoningLevel,
  resolveModelVariantFields,
  toModelReasoningLevel,
} from "@src/util/modelVariants";
import { selectableModelVariants } from "@src/util/selectableModelVariants";

import ModelTableTooltipContent from "./ModelTableTooltipContent";

// ── Ordering ──────────────────────────────────────────────────────────────────

const REASONING_ORDER: ModelReasoningLevel[] = [
  MODEL_REASONING_LEVEL.NONE,
  MODEL_REASONING_LEVEL.LOW,
  MODEL_REASONING_LEVEL.MEDIUM,
  MODEL_REASONING_LEVEL.HIGH,
  MODEL_REASONING_LEVEL.EXTRA_HIGH,
  MODEL_REASONING_LEVEL.MAX,
  MODEL_REASONING_LEVEL.ULTRA,
  MODEL_REASONING_LEVEL.ULTRACODE,
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface EffortGroup {
  key: string;
  label: string;
  rank: number;
  variants: ModelTableVariantInfo[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRawSuffixTokens(variant: ModelTableVariantInfo): string[] {
  const { model, base_model: base } = variant;
  if (!base) return [];
  const modelLower = model.toLowerCase();
  const baseLower = base.toLowerCase();
  if (!modelLower.startsWith(`${baseLower}-`)) return [];
  return model
    .slice(base.length + 1)
    .split("-")
    .filter(Boolean);
}

function getRawSuffix(variant: ModelTableVariantInfo): string | undefined {
  const tokens = getRawSuffixTokens(variant).filter(
    (token) => token !== "fast" && token !== "thinking"
  );
  if (tokens.length === 0) return undefined;
  return tokens.join("-");
}

function variantSortValue(variant: ModelTableVariantInfo): number {
  const reasoning = toModelReasoningLevel(variant.reasoning);
  if (!reasoning) return -1;
  return REASONING_ORDER.indexOf(reasoning);
}

function toTitleCaseSuffix(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

// ── GPT: group by reasoning level ─────────────────────────────────────────────

const BASE_EFFORT_LABEL = formatReasoningLevel(MODEL_REASONING_LEVEL.BASELINE);

function isUnsuffixedBaseVariant(variant: ModelTableVariantInfo): boolean {
  return variant.model.toLowerCase() === variant.base_model.toLowerCase();
}

function isBaseEffortVariant(variant: ModelTableVariantInfo): boolean {
  if (isUnsuffixedBaseVariant(variant)) return true;
  if (toModelReasoningLevel(variant.reasoning)) return false;

  const modelLower = variant.model.toLowerCase();
  const baseLower = variant.base_model.toLowerCase();
  return variant.fast && modelLower === `${baseLower}-fast`;
}

function getReasoningEffortMeta(
  variant: ModelTableVariantInfo
): Omit<EffortGroup, "variants"> {
  if (isBaseEffortVariant(variant)) {
    return { key: "base", label: BASE_EFFORT_LABEL, rank: -1 };
  }

  const reasoning = toModelReasoningLevel(variant.reasoning);
  if (reasoning === MODEL_REASONING_LEVEL.NONE) {
    return { key: MODEL_REASONING_LEVEL.NONE, label: "No reasoning", rank: 0 };
  }
  if (reasoning) {
    return {
      key: reasoning,
      label: formatReasoningLevel(reasoning),
      rank: REASONING_ORDER.indexOf(reasoning),
    };
  }
  const rawSuffix = getRawSuffix(variant);
  if (rawSuffix) {
    return { key: rawSuffix, label: toTitleCaseSuffix(rawSuffix), rank: 100 };
  }
  return { key: MODEL_REASONING_LEVEL.NONE, label: "No reasoning", rank: 0 };
}

// ── Build effort groups ───────────────────────────────────────────────────────

type EffortStyle = "reasoning" | "speed" | "models";

function getSpeedMeta(label: string): Omit<EffortGroup, "variants"> {
  return { key: "speed", label, rank: 0 };
}

function getModelsMeta(label: string): Omit<EffortGroup, "variants"> {
  return { key: "models", label, rank: 0 };
}

function groupVariantsByEffort(
  variants: ModelTableVariantInfo[],
  style: EffortStyle,
  speedLabel: string,
  modelsLabel: string
): EffortGroup[] {
  const getMeta =
    style === "speed"
      ? () => getSpeedMeta(speedLabel)
      : style === "models"
        ? () => getModelsMeta(modelsLabel)
        : getReasoningEffortMeta;
  const grouped = new Map<string, EffortGroup>();
  for (const variant of variants) {
    const meta = getMeta(variant);
    const existing = grouped.get(meta.key);
    if (existing) {
      existing.variants.push(variant);
      continue;
    }
    grouped.set(meta.key, { ...meta, variants: [variant] });
  }
  return Array.from(grouped.values()).sort((groupA, groupB) => {
    if (groupA.rank !== groupB.rank) return groupA.rank - groupB.rank;
    return groupA.label.localeCompare(groupB.label);
  });
}

function hasSuffixThinking(variant: ModelTableVariantInfo): boolean {
  return getRawSuffixTokens(variant).includes("thinking");
}

function isGptGroup(variants: ModelTableVariantInfo[]): boolean {
  return variants.some(
    (variant) =>
      variant.model.toLowerCase().startsWith("gpt-") ||
      variant.base_model.toLowerCase().startsWith("gpt-")
  );
}

function isOSeriesGroup(variants: ModelTableVariantInfo[]): boolean {
  return variants.some(
    (variant) => /^o\d/i.test(variant.model) || /^o\d/i.test(variant.base_model)
  );
}

function isSpeedOnlyGroup(variants: ModelTableVariantInfo[]): boolean {
  if (variants.length === 0) return false;
  if (isGptGroup(variants) || isOSeriesGroup(variants)) return false;
  return variants.every(isBaseEffortVariant);
}

function isComposerGroup(variants: ModelTableVariantInfo[]): boolean {
  return variants.some(
    (variant) =>
      variant.model.toLowerCase().startsWith("composer-") ||
      variant.base_model.toLowerCase().startsWith("composer-")
  );
}

function getPillLabel(
  variant: ModelTableVariantInfo,
  gptGroup: boolean,
  composerGroup: boolean,
  oSeriesGroup: boolean,
  isModelList: boolean
): string {
  if (isModelList) return formatModelNameFull(variant.model);
  if (gptGroup || composerGroup) return variant.fast ? "Fast" : "Standard";
  if (oSeriesGroup) {
    const rawSuffix = getRawSuffix(variant);
    if (rawSuffix) {
      const normalized = rawSuffix.toLowerCase();
      if (normalized === "mini" || normalized === "nano") {
        return toTitleCaseSuffix(rawSuffix);
      }
    }
    return variant.fast ? "Fast" : "Standard";
  }
  const thinking = hasSuffixThinking(variant);
  if (thinking && variant.fast) return "Thinking + Fast";
  if (thinking) return "Thinking";
  if (variant.fast) return "Fast";
  return "Standard";
}

/**
 * Sort key for pills within a row: Default | Thinking | Default fast | Thinking fast
 * Encodes (fast, thinking) as a 2-bit value so the canonical order is always preserved.
 */
function pillSortKey(variant: ModelTableVariantInfo): number {
  const fastBit = variant.fast ? 2 : 0;
  const thinkingBit = hasSuffixThinking(variant) ? 1 : 0;
  return fastBit + thinkingBit;
}

// ── Sorting ───────────────────────────────────────────────────────────────────

/**
 * Selectable variants of one family in display order: by reasoning level
 * first, then by the canonical pill order within a level. Callers that derive
 * a family's canonical base model or its saved default share this ordering.
 */
export function sortVariantsForDisplay(
  variants: ModelTableVariantInfo[],
  forceModelList = false
): ModelTableVariantInfo[] {
  return (forceModelList ? [...variants] : selectableModelVariants(variants))
    .map((variant) => resolveModelVariantFields(variant.model, variant))
    .sort((variantA, variantB) => {
      const reasoningOrder =
        variantSortValue(variantA) - variantSortValue(variantB);
      if (reasoningOrder !== 0) return reasoningOrder;
      return pillSortKey(variantA) - pillSortKey(variantB);
    });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ModelVariantGridProps {
  /** Already sorted through {@link sortVariantsForDisplay}. */
  variants: ModelTableVariantInfo[];
  /** Render one row per model id instead of the effort matrix. */
  forceModelList?: boolean;
  /** Highlights the pill that is currently saved as the family default. */
  selectedModel?: string;
  /** Persists the tapped variant. Omit for a read-only grid. */
  onPick?: (modelId: string) => void;
}

export default function ModelVariantGrid({
  variants,
  forceModelList = false,
  selectedModel,
  onPick,
}: ModelVariantGridProps) {
  const { t } = useTranslation("integrations");

  const gptGroup = isGptGroup(variants);
  const oSeriesGroup = isOSeriesGroup(variants);
  const composerGroup = isComposerGroup(variants);
  const speedOnlyGroup = isSpeedOnlyGroup(variants);
  const effortStyle: EffortStyle = forceModelList
    ? "models"
    : composerGroup || speedOnlyGroup
      ? "speed"
      : "reasoning";

  // Pills are selectable whenever `onPick` is given — clicking one persists
  // the tapped variant as the new default for the canonical base model.
  // `selectedModel` highlights the active pill with the primary-6 border +
  // text treatment instead of the neutral border-2.
  const renderPills = (items: ModelTableVariantInfo[]) => (
    <div
      className={
        forceModelList
          ? "flex min-w-0 flex-col gap-0.5"
          : "flex min-w-0 flex-wrap justify-end gap-1.5"
      }
    >
      {items.map((variant) => {
        const pillText = getPillLabel(
          variant,
          gptGroup,
          composerGroup || speedOnlyGroup,
          oSeriesGroup,
          forceModelList
        );
        const pillContent = forceModelList ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <ModelIcon modelName={variant.model} size="small" />
            <span className="truncate">{pillText}</span>
          </span>
        ) : (
          pillText
        );

        const isSelected =
          selectedModel !== undefined && selectedModel === variant.model;
        const selectable = onPick !== undefined;
        const pillClass = `inline-flex h-[28px] max-w-full items-center gap-1.5 rounded-full border px-2.5 text-[12px] ${
          isSelected
            ? "border-primary-6 text-primary-6"
            : "border-border-2 text-text-2"
        }${selectable ? " cursor-pointer hover:bg-fill-2" : ""}`;

        const pill = selectable ? (
          <Button
            layout="custom"
            onClick={() => onPick?.(variant.model)}
            className={pillClass}
            aria-pressed={isSelected}
          >
            {pillContent}
          </Button>
        ) : (
          <span className={pillClass}>{pillContent}</span>
        );

        return (
          <div
            key={variant.model}
            className={forceModelList ? "min-w-0" : undefined}
          >
            <Tooltip
              content={<ModelTableTooltipContent model={variant.model} />}
              position="top"
            >
              {pill}
            </Tooltip>
          </div>
        );
      })}
    </div>
  );

  const effortGroups = useMemo(
    () =>
      forceModelList
        ? []
        : groupVariantsByEffort(
            variants,
            effortStyle,
            t("modelsTable.variantSpeed"),
            t("modelsTabs.models")
          ),
    [effortStyle, forceModelList, t, variants]
  );

  if (forceModelList) return renderPills(variants);

  if (effortGroups.length === 0) {
    return <span className="text-text-3">—</span>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {effortGroups.map((group) => (
        <div
          key={group.key}
          className="flex h-9 min-h-9 min-w-0 items-center justify-between gap-6 text-xs"
        >
          <span className="shrink-0 font-medium text-text-1">
            {group.label}
          </span>
          {renderPills(
            [...group.variants].sort(
              (variantA, variantB) =>
                pillSortKey(variantA) - pillSortKey(variantB)
            )
          )}
        </div>
      ))}
    </div>
  );
}

import type { TFunction } from "i18next";
import React, { memo } from "react";

import Button from "@src/components/Button";
import RefreshButton from "@src/components/Button/RefreshButton";
import Textarea from "@src/components/Textarea";
import { useHousekeeperConfig } from "@src/hooks/housekeeper";
import {
  ArchiveIcon,
  Cancel01Icon,
  ChevronsDownUpIcon,
  HugeiconsIcon,
  UnfoldMoreIcon,
} from "@src/icons";

import ContextBreakdownBar from "./ContextBreakdownBar";
import ContextCategoryRow from "./ContextCategoryRow";
import MiniCpmCompactCard from "./MiniCpmCompactCard";
import type { PanelCategory, RingTone } from "./contextInfoTypes";
import { formatTokenCount } from "./useContextUsageInfo";

const ConfiguredMiniCpmCompactCard: React.FC<{ sessionId: string }> = memo(
  ({ sessionId }) => {
    const housekeeper = useHousekeeperConfig();
    if (!housekeeper.isConfigured) return null;
    return (
      <div className="mt-2">
        <MiniCpmCompactCard sessionId={sessionId} />
      </div>
    );
  }
);

ConfiguredMiniCpmCompactCard.displayName = "ConfiguredMiniCpmCompactCard";

interface ContextInfoPanelSummaryProps {
  cacheHitRate: number;
  cacheReadTokens: number;
  cacheSavedTokens: number;
  cacheWriteTokens: number;
  categories: PanelCategory[];
  close: () => void;
  hasCache: boolean;
  hoveredKey: string | null;
  manualCompactExpanded: boolean;
  maxTokens: number;
  percentage: number;
  refresh: () => void;
  refreshError: string | null;
  refreshing: boolean;
  ringTone: RingTone;
  sessionId: string | undefined;
  showCacheHero: boolean;
  t: TFunction;
  tokenLabel: string;
}

/** Panel head: title with refresh and close, usage line, cache savings, auto-compact note and breakdown bar. */
export const ContextInfoPanelSummary: React.FC<
  ContextInfoPanelSummaryProps
> = ({
  cacheHitRate,
  cacheReadTokens,
  cacheSavedTokens,
  cacheWriteTokens,
  categories,
  close,
  hasCache,
  hoveredKey,
  manualCompactExpanded,
  maxTokens,
  percentage,
  refresh,
  refreshError,
  refreshing,
  ringTone,
  sessionId,
  showCacheHero,
  t,
  tokenLabel,
}) => (
  <div className="px-4 pt-3.5 pb-3">
    <div className="flex items-center justify-between">
      <span className="text-[13px] font-semibold text-text-1">
        {t("contextInfo.title")}
      </span>
      <div className="flex items-center gap-1">
        <RefreshButton
          iconOnly
          label={t("common:actions.refresh")}
          refreshing={refreshing}
          disabled={!sessionId}
          onRefresh={refresh}
        />
        <Button
          variant="tertiary"
          size="small"
          iconOnly
          onClick={close}
          aria-label={t("common:actions.close")}
          title={t("common:actions.close")}
          icon={<HugeiconsIcon icon={Cancel01Icon} data-icon="x" size={14} />}
        />
      </div>
    </div>
    {refreshError && (
      <p role="alert" className="mt-1 text-xs text-text-3">
        {refreshError}
      </p>
    )}

    <p className="mt-0.5 text-[13px] text-text-3">{tokenLabel}</p>

    {!manualCompactExpanded &&
      (showCacheHero ? (
        <div className="mt-2 rounded-lg bg-green-500/10 px-2.5 py-1.5">
          <p className="text-[12px] font-semibold text-green-600">
            {t("contextInfo.cacheHero", {
              pct: Math.round(cacheHitRate * 100),
              tokens: formatTokenCount(cacheSavedTokens),
            })}
          </p>
          <p className="mt-0.5 text-[10.5px] leading-snug text-text-3">
            {t("contextInfo.cacheHeroSub")}
          </p>
        </div>
      ) : (
        hasCache && (
          <p className="mt-0.5 text-[11px] text-green-600">
            {t("contextInfo.cacheSaved", {
              read: formatTokenCount(cacheReadTokens),
              write: formatTokenCount(cacheWriteTokens),
            })}
          </p>
        )
      ))}

    {ringTone !== "unused" && ringTone !== "normal" && (
      <p className="mt-1 text-[11px] leading-snug text-text-3">
        {t("contextInfo.autoCompactNote")}
      </p>
    )}

    <div className="mt-3">
      <ContextBreakdownBar
        categories={categories}
        maxTokens={maxTokens}
        hoveredKey={hoveredKey}
        fallbackPercentage={percentage}
      />
    </div>
  </div>
);

interface ContextInfoCategoryListProps {
  categories: PanelCategory[];
  handleMouseEnter: (key: string) => () => void;
  handleMouseLeave: () => void;
  hoveredKey: string | null;
}

/** One row per context category, highlighted in sync with the breakdown bar. */
export const ContextInfoCategoryList: React.FC<
  ContextInfoCategoryListProps
> = ({ categories, handleMouseEnter, handleMouseLeave, hoveredKey }) => (
  <div className="px-4 py-2">
    <div className="flex flex-col">
      {categories.map((cat) => (
        <ContextCategoryRow
          key={cat.key}
          categoryKey={cat.key}
          label={cat.label}
          tokens={cat.tokens}
          percent={cat.percent}
          hex={cat.hex}
          isHovered={hoveredKey === cat.key}
          onMouseEnter={handleMouseEnter(cat.key)}
          onMouseLeave={handleMouseLeave}
        />
      ))}
    </div>
  </div>
);

interface ContextInfoManualCompactSectionProps {
  compactDisabled: boolean;
  compactInstructions: string;
  contextCompactEnabled: boolean;
  handleInstructionsKeyDown: (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => void;
  housekeeperEnabled: boolean;
  manualCompactOpen: boolean;
  manualCompacting: boolean;
  runManualCompact: () => void;
  sessionId: string | undefined;
  setCompactInstructions: (value: string) => void;
  setManualCompactOpen: React.Dispatch<React.SetStateAction<boolean>>;
  t: TFunction;
}

/** Collapsible manual compaction: optional instructions, the compact action and the MiniCPM card. */
export const ContextInfoManualCompactSection: React.FC<
  ContextInfoManualCompactSectionProps
> = ({
  compactDisabled,
  compactInstructions,
  contextCompactEnabled,
  handleInstructionsKeyDown,
  housekeeperEnabled,
  manualCompactOpen,
  manualCompacting,
  runManualCompact,
  sessionId,
  setCompactInstructions,
  setManualCompactOpen,
  t,
}) => (
  <div className="border-t border-border-2 bg-fill-1/30 px-3.5 py-2">
    <div className="flex items-center justify-between px-1 py-1">
      <Button
        layout="custom"
        onClick={() => setManualCompactOpen((open) => !open)}
        aria-expanded={manualCompactOpen}
        className="flex-1 self-stretch text-left text-[13px] font-semibold text-text-1"
      >
        {t("contextInfo.manualCompactSectionTitle")}
      </Button>
      <Button
        variant="tertiary"
        size="small"
        iconOnly
        data-testid="context-info-manual-compact-toggle"
        onClick={() => setManualCompactOpen((open) => !open)}
        aria-expanded={manualCompactOpen}
        aria-label={t(
          manualCompactOpen
            ? "common:actions.collapse"
            : "common:actions.expand"
        )}
        icon={
          <HugeiconsIcon
            icon={manualCompactOpen ? ChevronsDownUpIcon : UnfoldMoreIcon}
            data-icon={
              manualCompactOpen ? "chevrons-down-up" : "chevrons-up-down"
            }
            size={14}
          />
        }
      />
    </div>

    {manualCompactOpen && (
      <div className="mt-2">
        <Textarea
          size="small"
          autoSize={{ minRows: 2, maxRows: 5 }}
          data-testid="context-info-compact-instructions-input"
          value={compactInstructions}
          onChange={(value) => setCompactInstructions(value)}
          onKeyDown={handleInstructionsKeyDown}
          placeholder={t("contextInfo.manualCompactInstructionsPlaceholder")}
        />
        <Button
          long
          size="small"
          className="mt-2"
          data-testid="context-info-manual-compact-button"
          icon={
            <HugeiconsIcon icon={ArchiveIcon} data-icon="archive" size={14} />
          }
          loading={manualCompacting}
          disabled={compactDisabled}
          onClick={runManualCompact}
        >
          {manualCompacting
            ? t("contextInfo.manualCompactRunning")
            : t("contextInfo.manualCompactAction")}
        </Button>

        {housekeeperEnabled && contextCompactEnabled && sessionId && (
          <ConfiguredMiniCpmCompactCard sessionId={sessionId} />
        )}
      </div>
    )}
  </div>
);

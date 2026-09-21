/**
 * ContextInfoButton
 *
 * Circular progress ring in the chat input toolbar. Click opens a popover
 * showing context fill, a segmented breakdown bar, and per-category rows.
 *
 * Data strategy:
 *   - `contextUsage` arrives from Rust after `agent:complete`.
 *   - Sections come from the final provider request payload only.
 *   - Categories with no live data are hidden, no mock/placeholder values.
 */
import { useAtomValue } from "jotai";
import React, { memo, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  PILL_CONTROL_ACTIVE_SURFACE_CLASS,
  PILL_CONTROL_HOVER_CLASS,
} from "@src/components/CompoundPill/config";
import { useConversationExecutionBinding } from "@src/engines/ChatPanel/ConversationExecutionBindingContext";
import {
  manualCompactInFlightSessionAtom,
  resolveManualCompactSessionId,
  useManualCompact,
} from "@src/engines/ChatPanel/hooks/useManualCompact";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { useSetting } from "@src/hooks/settings/useSettings";

import {
  ContextInfoCategoryList,
  ContextInfoManualCompactSection,
  ContextInfoPanelSummary,
} from "./ContextInfoPanelSections";
import { ContextInfoTrigger } from "./ContextInfoTrigger";
import { buildContextInfoCategories } from "./contextInfoCategories";
import { type PanelCategory, ringToneForPercentage } from "./contextInfoTypes";
import { useContextPanel } from "./useContextPanel";
import { useContextUsageInfo } from "./useContextUsageInfo";
import { useRefreshContextUsage } from "./useRefreshContextUsage";

export interface ContextInfoButtonProps {
  repoPath?: string;
  /**
   * "toolbar" - icon-only button (used in the right toolbar cluster).
   * "corner"  - icon + label pill anchored to the editor's bottom-right.
   */
  variant?: "toolbar" | "corner";
  /**
   * When true, the corner variant omits the text label and shows only the
   * progress ring. Use when horizontal space is tight (inline/compact row).
   */
  compact?: boolean;
}

const ContextInfoButton: React.FC<ContextInfoButtonProps> = memo(
  ({ variant = "toolbar", compact = false }) => {
    const { t } = useTranslation();
    const {
      refresh,
      refreshing,
      error: refreshError,
    } = useRefreshContextUsage();
    const { sessionId } = useSessionId();
    const executionBinding = useConversationExecutionBinding();
    const [housekeeperEnabled] = useSetting("housekeeper.enabled");
    const [contextCompactEnabled] = useSetting(
      "housekeeper.features.contextCompact"
    );
    const { runManualCompact: runSharedManualCompact } = useManualCompact();
    const compactingSessionId = useAtomValue(manualCompactInFlightSessionAtom);
    const {
      percentage,
      tokenLabel,
      maxTokens,
      displayTokens,
      contextUsage,
      cacheReadTokens,
      cacheWriteTokens,
      cacheHitRate,
      cacheSavedTokens,
    } = useContextUsageInfo();

    const { panelPos, triggerRef, panelRef, toggle, close } = useContextPanel();
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const [compactInstructions, setCompactInstructions] = useState("");
    const [manualCompactOpen, setManualCompactOpen] = useState(false);
    // Shared in-flight state: covers compactions started from this popover
    // AND from the `/compact` slash command.
    const manualCompacting = compactingSessionId !== null;

    const ringTone = ringToneForPercentage(percentage);
    const displayPct = percentage > 100 ? 100 : percentage;
    const cornerLabelClass =
      ringTone === "unused" ? "text-text-4" : "text-text-2";
    const hasCache = cacheReadTokens > 0 || cacheWriteTokens > 0;
    // Surface the cache savings as the hero line whenever there is a
    // meaningful hit rate. This is ORGII's cost advantage over CC / Codex /
    // Cursor and the thing the user should notice first.
    const showCacheHero = cacheHitRate > 0.05 && cacheSavedTokens > 0;
    // Keep the corner pill calm: only show the running percentage once we are
    // actually approaching the auto-compaction zone.
    const showCornerPercent = percentage >= 90;

    const categories: PanelCategory[] = useMemo(
      () => buildContextInfoCategories(contextUsage, displayTokens, t),
      [contextUsage, displayTokens, t]
    );

    const handleMouseEnter = useCallback(
      (key: string) => () => setHoveredKey(key),
      []
    );
    const handleMouseLeave = useCallback(() => setHoveredKey(null), []);
    const runManualCompact = useCallback(async () => {
      if (manualCompacting) return;
      const compacted = await runSharedManualCompact(
        sessionId,
        compactInstructions
      );
      // React 18: state updates after unmount are safe no-ops, so the
      // popover closing mid-compaction needs no mounted guard here.
      if (compacted) setCompactInstructions("");
    }, [
      manualCompacting,
      sessionId,
      compactInstructions,
      runSharedManualCompact,
    ]);

    const handleInstructionsKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.nativeEvent.isComposing
        )
          return;
        event.preventDefault();
        void runManualCompact();
      },
      [runManualCompact]
    );

    const manualCompactSupported =
      resolveManualCompactSessionId(sessionId, executionBinding) !== null;
    const manualCompactExpanded = manualCompactSupported && manualCompactOpen;
    const compactDisabled = manualCompacting || !manualCompactSupported;
    const triggerSurfaceClass =
      panelPos !== null
        ? PILL_CONTROL_ACTIVE_SURFACE_CLASS
        : PILL_CONTROL_HOVER_CLASS;

    return (
      <>
        <ContextInfoTrigger
          compact={compact}
          cornerLabelClass={cornerLabelClass}
          displayPct={displayPct}
          panelPos={panelPos}
          percentage={percentage}
          ringTone={ringTone}
          showCornerPercent={showCornerPercent}
          t={t}
          toggle={toggle}
          triggerRef={triggerRef}
          triggerSurfaceClass={triggerSurfaceClass}
          variant={variant}
        />

        {panelPos &&
          createPortal(
            <div
              ref={panelRef}
              data-testid="context-info-panel"
              className="fixed z-99999 w-[320px] overflow-hidden rounded-xl border border-border-2 bg-bg-2 shadow-2xl"
              style={{ bottom: panelPos.bottom, right: panelPos.right }}
            >
              <ContextInfoPanelSummary
                cacheHitRate={cacheHitRate}
                cacheReadTokens={cacheReadTokens}
                cacheSavedTokens={cacheSavedTokens}
                cacheWriteTokens={cacheWriteTokens}
                categories={categories}
                close={close}
                hasCache={hasCache}
                hoveredKey={hoveredKey}
                manualCompactExpanded={manualCompactExpanded}
                maxTokens={maxTokens}
                percentage={percentage}
                refresh={refresh}
                refreshError={refreshError}
                refreshing={refreshing}
                ringTone={ringTone}
                sessionId={sessionId}
                showCacheHero={showCacheHero}
                t={t}
                tokenLabel={tokenLabel}
              />

              {!manualCompactExpanded && categories.length > 0 && (
                <ContextInfoCategoryList
                  categories={categories}
                  handleMouseEnter={handleMouseEnter}
                  handleMouseLeave={handleMouseLeave}
                  hoveredKey={hoveredKey}
                />
              )}

              {manualCompactSupported && (
                <ContextInfoManualCompactSection
                  compactDisabled={compactDisabled}
                  compactInstructions={compactInstructions}
                  contextCompactEnabled={contextCompactEnabled}
                  handleInstructionsKeyDown={handleInstructionsKeyDown}
                  housekeeperEnabled={housekeeperEnabled}
                  manualCompactOpen={manualCompactOpen}
                  manualCompacting={manualCompacting}
                  runManualCompact={runManualCompact}
                  sessionId={sessionId}
                  setCompactInstructions={setCompactInstructions}
                  setManualCompactOpen={setManualCompactOpen}
                  t={t}
                />
              )}
            </div>,
            document.body
          )}
      </>
    );
  }
);

ContextInfoButton.displayName = "ContextInfoButton";

export default ContextInfoButton;

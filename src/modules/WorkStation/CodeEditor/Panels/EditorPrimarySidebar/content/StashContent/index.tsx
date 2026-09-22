/**
 * StashContent Component
 *
 * Displays git stashes with a shared sidebar header:
 * - List of stashes with index and message
 * - Actions: Apply, Pop, Drop per stash
 * - Pop All button in header
 *
 * In the Stashes destination, the header includes back navigation and remains
 * available for an empty list. Embedded lists retain their collapse behavior.
 */
import React, { memo, useCallback, useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { StashEntry } from "@src/api/http/git/types";
import Button from "@src/components/Button";
import HoverCard from "@src/components/HoverCard";
import { HoverCardPanel } from "@src/components/HoverCard/HoverCardBase";
import { HoverCardMetadataRow } from "@src/components/HoverCard/HoverCardMetadataRow";
import {
  TreeRowActionGroup,
  TreeRowBase,
  type TreeRowNode,
} from "@src/components/TreeRow";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { useWorkStationTabs } from "@src/hooks/tabHost/useWorkStationTabs";
import {
  ArchiveArrowUpIcon,
  ArrowDownToLineIcon,
  ArrowLeft02Icon,
  Delete02Icon,
  HugeiconsIcon,
  Loading03Icon,
  PackageIcon,
  WorkflowCircle05Icon,
} from "@src/icons";
import CollapsibleSection from "@src/modules/WorkStation/shared/PrimarySidebarLayout/CollapsibleSection";
import {
  type SourceControlHistorySelection,
  createStashDetailTab,
} from "@src/store/workstation/tabs";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import { StashHeaderContext } from "./StashHeaderContext";

// ============================================
// Types
// ============================================

interface StashContentProps {
  /** List of stashes */
  stashes: StashEntry[];
  /** Whether any stash operation is in progress */
  operationLoading: boolean;
  /** Whether the stash list starts collapsed. */
  initialCollapsed?: boolean;
  /** Callback to apply a stash (keeps stash) */
  onStashApply: (index: number) => Promise<boolean>;
  /** Callback to pop a stash (applies and removes) */
  onStashPop: (index: number) => Promise<boolean>;
  /** Callback to drop a stash (removes without applying) */
  onStashDrop: (index: number) => Promise<boolean>;
  /** Receives the selected stash when the host wants inline detail rendering. */
  onHistorySelectionChange?: (selection: SourceControlHistorySelection) => void;
}

// ============================================
// StashItem Component
// ============================================

interface StashItemProps {
  stash: StashEntry;
  operationLoading: boolean;
  isSelected: boolean;
  onApply: (index: number) => Promise<boolean>;
  onPop: (index: number) => Promise<boolean>;
  onDrop: (index: number) => Promise<boolean>;
  onOpenDetail: (stash: StashEntry) => void;
}

function getStashIdentity(stash: StashEntry): string {
  const normalizedCommitSha = stash.commit_sha?.trim();
  return normalizedCommitSha || `stash@{${stash.index}}`;
}

function getStashDisplayMessage(stash: StashEntry): string {
  const displayMessage = stash.message || `stash@{${stash.index}}`;
  const messageMatch = displayMessage.match(/: (.+)$/);
  return messageMatch ? messageMatch[1] : displayMessage;
}

function createStashHistorySelection(
  stash: StashEntry
): Extract<SourceControlHistorySelection, { type: "stash" }> {
  const stashRef = `stash@{${stash.index}}`;
  const normalizedCommitSha = stash.commit_sha?.trim();
  const stashIdentity = normalizedCommitSha || stashRef;
  const shortSha =
    normalizedCommitSha && normalizedCommitSha.length >= 8
      ? normalizedCommitSha.slice(0, 8)
      : stashRef;

  return {
    type: "stash",
    stashIndex: stash.index,
    stashRef,
    stashIdentity,
    stashCommitSha: normalizedCommitSha ?? null,
    commitSha: stashIdentity,
    shortSha,
    commitMessage: getStashDisplayMessage(stash) || stashRef,
  };
}

const StashItem: React.FC<StashItemProps> = memo(
  ({
    stash,
    operationLoading,
    isSelected,
    onApply,
    onPop,
    onDrop,
    onOpenDetail,
  }) => {
    const { t } = useTranslation();
    const [actionLoading, setActionLoading] = useState<
      "apply" | "pop" | "drop" | null
    >(null);

    const handleApply = useCallback(
      async (event: React.MouseEvent) => {
        event.stopPropagation();
        setActionLoading("apply");
        await onApply(stash.index);
        setActionLoading(null);
      },
      [stash.index, onApply]
    );

    const handlePop = useCallback(
      async (event: React.MouseEvent) => {
        event.stopPropagation();
        setActionLoading("pop");
        await onPop(stash.index);
        setActionLoading(null);
      },
      [stash.index, onPop]
    );

    const handleDrop = useCallback(
      async (event: React.MouseEvent) => {
        event.stopPropagation();
        const shortMessage = getStashDisplayMessage(stash);
        const stashRef =
          shortMessage && !shortMessage.startsWith("stash@")
            ? `stash@{${stash.index}} (${shortMessage})`
            : `stash@{${stash.index}}`;

        const confirmed = await confirmDestructiveAction({
          title: t("confirmation.dropStashTitle"),
          message: t("confirmation.dropStashMessage", { stashRef }),
          okLabel: t("actions.delete"),
          cancelLabel: t("actions.cancel"),
        });
        if (!confirmed) return;

        setActionLoading("drop");
        await onDrop(stash.index);
        setActionLoading(null);
      },
      [stash, onDrop, t]
    );

    const handleOpenDetail = useCallback(() => {
      onOpenDetail(stash);
    }, [onOpenDetail, stash]);

    const isLoading = operationLoading || actionLoading !== null;

    const shortMessage = getStashDisplayMessage(stash);

    // Build TreeRowNode for TreeRowBase
    const treeNode: TreeRowNode = useMemo(
      () => ({
        id: `stash-${stash.index}`,
        name: shortMessage,
        path: `stash@{${stash.index}}`,
        type: "file",
        icon: (
          <HugeiconsIcon
            icon={PackageIcon}
            data-icon="package"
            size={14}
            className="text-text-3"
          />
        ),
      }),
      [stash.index, shortMessage]
    );

    return (
      <HoverCard
        cardId={`git-stash:${getStashIdentity(stash)}`}
        position="right-start"
        content={
          <HoverCardPanel title={`stash@{${stash.index}}`}>
            <HoverCardMetadataRow icon={PackageIcon}>
              <div className="break-words whitespace-pre-wrap">
                {shortMessage}
              </div>
            </HoverCardMetadataRow>
            {stash.branch && (
              <HoverCardMetadataRow icon={WorkflowCircle05Icon}>
                <div className="break-words">{stash.branch}</div>
              </HoverCardMetadataRow>
            )}
          </HoverCardPanel>
        }
      >
        <div>
          <TreeRowBase
            node={treeNode}
            showNativeTitle={false}
            depth={0}
            isSelected={isSelected}
            onClick={handleOpenDetail}
          >
            {/* Index badge */}
            <span className="shrink-0 text-[11px] text-text-3">
              {stash.index}
            </span>

            {/* Action buttons - visible on hover and keyboard focus */}
            <TreeRowActionGroup>
              <Button
                size="sidebar"
                variant="tertiary"
                iconOnly
                onClick={handleApply}
                disabled={isLoading}
                loading={actionLoading === "apply"}
                title={t("tooltips.applyStash")}
                aria-label={t("tooltips.applyStash")}
                icon={
                  <HugeiconsIcon
                    icon={ArrowDownToLineIcon}
                    data-icon="arrow-down-to-line"
                    size={HEADER_ICON_SIZE.sm}
                    strokeWidth={1.75}
                  />
                }
              />
              <Button
                size="sidebar"
                variant="tertiary"
                iconOnly
                onClick={handlePop}
                disabled={isLoading}
                loading={actionLoading === "pop"}
                title={t("tooltips.popStash")}
                aria-label={t("tooltips.popStash")}
                icon={
                  <HugeiconsIcon
                    icon={ArchiveArrowUpIcon}
                    data-icon="archive-restore"
                    size={HEADER_ICON_SIZE.sm}
                    strokeWidth={1.75}
                  />
                }
              />
              <Button
                size="sidebar"
                variant="tertiary"
                tone="danger"
                iconOnly
                onClick={handleDrop}
                disabled={isLoading}
                loading={actionLoading === "drop"}
                title={t("tooltips.dropStash")}
                aria-label={t("tooltips.dropStash")}
                icon={
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    data-icon="trash-2"
                    size={HEADER_ICON_SIZE.sm}
                    strokeWidth={1.75}
                  />
                }
              />
            </TreeRowActionGroup>
          </TreeRowBase>
        </div>
      </HoverCard>
    );
  }
);

StashItem.displayName = "StashItem";

// ============================================
// Main Component
// ============================================

export const StashContent: React.FC<StashContentProps> = memo(
  ({
    stashes,
    operationLoading,
    initialCollapsed = true,
    onStashApply,
    onStashPop,
    onStashDrop,
    onHistorySelectionChange,
  }) => {
    const { t } = useTranslation();
    const { openTab, activeTab } = useWorkStationTabs();
    const header = useContext(StashHeaderContext);
    const [collapsed, setCollapsed] = useState(initialCollapsed);
    const [isPoppingAll, setIsPoppingAll] = useState(false);

    const stashCount = stashes.length;
    const hasStashes = stashCount > 0;
    const sourceControlHistorySelection =
      activeTab?.type === "source-control" &&
      activeTab.data.historySelection &&
      typeof activeTab.data.historySelection === "object"
        ? (activeTab.data.historySelection as SourceControlHistorySelection)
        : null;
    const activeStashIdentity =
      sourceControlHistorySelection?.type === "stash"
        ? sourceControlHistorySelection.stashIdentity
        : activeTab?.type === "git-stash-detail"
          ? typeof activeTab.data.stashIdentity === "string"
            ? activeTab.data.stashIdentity
            : typeof activeTab.data.stashCommitSha === "string"
              ? activeTab.data.stashCommitSha
              : typeof activeTab.data.stashRef === "string"
                ? activeTab.data.stashRef
                : null
          : null;

    const handleOpenStashDetail = useCallback(
      (stash: StashEntry) => {
        const selection = createStashHistorySelection(stash);
        if (onHistorySelectionChange) {
          onHistorySelectionChange(selection);
          return;
        }
        const tab = createStashDetailTab(
          stash.index,
          selection.commitMessage,
          stash.commit_sha
        );
        openTab(tab);
      },
      [onHistorySelectionChange, openTab]
    );

    // Handle pop all stashes (apply all from newest to oldest)
    const handlePopAll = useCallback(async () => {
      if (!hasStashes) return;

      // Confirm before popping all
      const confirmed = await confirmDestructiveAction({
        title: t("confirmation.popAllStashesTitle"),
        message: t("confirmation.popAllStashesMessage", { count: stashCount }),
        okLabel: t("actions.confirm"),
        cancelLabel: t("actions.cancel"),
      });
      if (!confirmed) return;

      setIsPoppingAll(true);
      // Pop stashes from index 0 repeatedly (as each pop removes index 0)
      for (let index = 0; index < stashCount; index++) {
        const success = await onStashPop(0);
        if (!success) break;
      }
      setIsPoppingAll(false);
    }, [hasStashes, stashCount, onStashPop, t]);

    // Don't render section if no stashes
    if (!hasStashes && !header) {
      return null;
    }

    const title = t("common:labels.stashesCount", { count: stashCount });
    const popAllAction = {
      key: "pop-all-stashes",
      icon: (
        <HugeiconsIcon
          icon={isPoppingAll ? Loading03Icon : ArchiveArrowUpIcon}
          size={HEADER_ICON_SIZE.sm}
          className={isPoppingAll ? "animate-spin" : undefined}
        />
      ),
      tooltip: t("tooltips.popAllStashes"),
      onClick: handlePopAll,
      disabled: !hasStashes || operationLoading || isPoppingAll,
      forceVisible: true,
    };
    return (
      <CollapsibleSection
        title={
          header ? (
            <Button
              layout="custom"
              className="flex min-w-0 items-center gap-1.5 normal-case"
              onClick={header.onBack}
              aria-label={t("tabs.sourceControl")}
              title={t("tabs.sourceControl")}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <HugeiconsIcon
                  icon={ArrowLeft02Icon}
                  size={14}
                  className="text-text-3"
                />
              </span>
              <span className="truncate">{title}</span>
            </Button>
          ) : (
            title
          )
        }
        collapsible={!header}
        collapsed={collapsed}
        onCollapseChange={setCollapsed}
        actions={[popAllAction, ...(header?.actions ?? [])]}
        isLast
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {stashes.map((stash) => (
            <StashItem
              key={getStashIdentity(stash)}
              stash={stash}
              operationLoading={operationLoading}
              isSelected={activeStashIdentity === getStashIdentity(stash)}
              onApply={onStashApply}
              onPop={onStashPop}
              onDrop={onStashDrop}
              onOpenDetail={handleOpenStashDetail}
            />
          ))}
        </div>
      </CollapsibleSection>
    );
  }
);

StashContent.displayName = "StashContent";

export default StashContent;

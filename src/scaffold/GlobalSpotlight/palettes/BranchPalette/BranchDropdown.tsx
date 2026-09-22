/**
 * BranchDropdown
 *
 * Anchored, compact variant of `BranchPalette` for the core switch path
 * (checkout an existing branch). Create / Create-from / Delete /
 * detached-HEAD flows are intentionally absent — those remain in the
 * Spotlight variant because they involve nested input modes.
 *
 * Chosen by `general.modelPickerStyle === "dropdown"`. Falls through to
 * `BranchPalette` (Spotlight) otherwise.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import DropdownSearch from "@src/components/Dropdown/DropdownSearch";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import {
  type UseDropdownListNavigationReturn,
  useDropdownEngine,
} from "@src/hooks/dropdown";
import { useFilteredItems } from "@src/hooks/search";
import {
  FolderClosedIcon,
  HugeiconsIcon,
  WorkflowCircle05Icon,
} from "@src/icons";

import { PickerOptionRow } from "../../components/PickerOptionRow";
import { SpotlightDetailPane } from "../../components/SpotlightDetailPane";
import { PickerDropdownShell } from "../../shell/PickerDropdownShell";
import type { BranchItem } from "../../types";
import { categorizeBranches } from "../../utils/branchUtils";
import { BranchDropdownList } from "./BranchDropdownList";
import { type BranchPickerTab, BranchPickerTabs } from "./BranchPickerTabs";
import { BranchPullRequestPicker } from "./BranchPullRequestPicker";
import { useBranchFetch } from "./useBranchFetch";
import { useWorktreeMap } from "./useWorktreeMap";

const LIST_MAX_HEIGHT = 360;

interface BranchListRow {
  branch: BranchItem;
  heading: string | null;
}
const branchRowKey = (row: BranchListRow) => row.branch.name;
const branchRowHeight = (row: BranchListRow) =>
  DROPDOWN_ITEM.height + (row.heading ? 24 : 0);

interface BranchRowProps {
  branch: BranchItem;
  isCurrent: boolean;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

const BranchRow: React.FC<BranchRowProps> = ({
  branch,
  isCurrent,
  keyboardProps,
}) => {
  return (
    <SpotlightDetailPane
      item={{
        id: branch.name,
        label: branch.name,
        type: "branch",
        data: { ...branch, isCurrentSelection: isCurrent },
      }}
    >
      <PickerOptionRow
        label={branch.name}
        selected={isCurrent}
        testId={`branch-dropdown-row-${branch.name}`}
        keyboardProps={keyboardProps}
        icon={
          <HugeiconsIcon
            icon={branch.worktreePath ? FolderClosedIcon : WorkflowCircle05Icon}
            size={DROPDOWN_ITEM.iconSize}
            className="text-text-2"
          />
        }
      />
    </SpotlightDetailPane>
  );
};

interface BranchDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (
    branchName: string,
    branch: BranchItem
  ) => boolean | void | Promise<boolean | void>;
  repoId: string;
  repoPath?: string;
  currentBranchName?: string;
  githubConnectionId?: string;
  githubRepoFullName?: string;
  groupWorktreeBranches?: boolean;
  /** Element the dropdown is anchored to. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Preferred vertical side of the anchor. */
  placement?: "top" | "bottom" | "auto";
}

export const BranchDropdown: React.FC<BranchDropdownProps> = ({
  isOpen,
  onClose,
  onSelect,
  repoId,
  repoPath,
  currentBranchName,
  githubConnectionId,
  githubRepoFullName,
  groupWorktreeBranches = true,
  anchorRef,
  placement = "bottom",
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<BranchPickerTab>("branches");
  const branchTabOpen = isOpen && tab === "branches";
  const [searchQuery, setSearchQuery] = useState("");
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setSearchQuery("");
      setTab("branches");
    }
  }

  const isGitHubRepo = Boolean(githubConnectionId && githubRepoFullName);

  const {
    branches: rawBranches,
    isLoading,
    repoPath: resolvedRepoPath,
    refresh: refreshBranches,
  } = useBranchFetch({
    isOpen: branchTabOpen,
    repoId,
    repoPath: repoPath || "",
    isGitHubRepo,
    githubConnectionId,
    githubRepoFullName,
  });

  const worktreeMap = useWorktreeMap({
    enabled: branchTabOpen && groupWorktreeBranches,
    repoId,
    repoPath,
    isLocalRepo: !isGitHubRepo,
  });

  // Merge worktreePath onto each BranchItem so categorizeBranches() can
  // bucket them. Stable identity when there are no worktrees so we don't
  // thrash downstream filters.
  const branches = useMemo(() => {
    if (worktreeMap.size === 0) return rawBranches;
    return rawBranches.map((branch) => {
      const worktreePath = worktreeMap.get(branch.name);
      if (!worktreePath) return branch;
      return { ...branch, worktreePath };
    });
  }, [rawBranches, worktreeMap]);

  const { filteredItems: filteredBranches } = useFilteredItems({
    items: branches,
    searchQuery,
    getSearchText: (branch) => branch.name,
  });

  const sections = useMemo(() => {
    const categorized = categorizeBranches(filteredBranches);
    const result: Array<{
      key: "default" | "recent" | "worktrees" | "other";
      label: string | null;
      items: BranchItem[];
    }> = [];
    if (categorized.default.length > 0) {
      result.push({
        key: "default",
        label: t("selectors.branch.labels.defaultBranches"),
        items: categorized.default,
      });
    }
    if (categorized.recent.length > 0) {
      // Recent needs a heading only when Default sits above it.
      result.push({
        key: "recent",
        label: result.length > 0 ? t("selectors.branch.labels.recent") : null,
        items: categorized.recent,
      });
    }
    if (categorized.worktrees.length > 0) {
      result.push({
        key: "worktrees",
        label: t("selectors.branch.labels.worktrees"),
        items: categorized.worktrees,
      });
    }
    if (categorized.other.length > 0) {
      result.push({
        key: "other",
        label: t("selectors.branch.labels.otherBranches"),
        items: categorized.other,
      });
    }
    return result;
  }, [filteredBranches, t]);

  const rows = useMemo(
    () =>
      sections.flatMap((section) =>
        section.items.map((branch, index) => ({
          branch,
          heading: index === 0 ? section.label : null,
        }))
      ),
    [sections]
  );
  const visibleBranches = useMemo(() => rows.map((row) => row.branch), [rows]);

  const handleSelect = useCallback(
    async (branch: BranchItem) => {
      const shouldClose = await onSelect(branch.name, branch);
      if (shouldClose !== false) {
        onClose();
      }
    },
    [onSelect, onClose]
  );

  const { isPositioned, panelRef, panelPosition, keyboard } = useDropdownEngine<
    HTMLElement,
    BranchItem
  >({
    open: branchTabOpen,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    anchorRef,
    placement,
    gap: DROPDOWN_PANEL.triggerGap,
    listNavigation: {
      items: visibleBranches,
      onSelect: handleSelect,
      initialSelectedIndex: -1,
    },
  });

  useEffect(() => {
    if (!branchTabOpen || !isPositioned) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [branchTabOpen, isPositioned]);

  if (isOpen && tab === "prs")
    return (
      <BranchPullRequestPicker
        key={`${repoId}:${resolvedRepoPath}`}
        repoId={repoId}
        repoPath={resolvedRepoPath}
        onSelect={onSelect}
        onClose={onClose}
        onBranchPrepared={refreshBranches}
        onTabChange={setTab}
        presentation="dropdown"
        anchorRef={anchorRef}
        placement={placement}
      />
    );
  if (!isOpen || !isPositioned) return null;

  return (
    <PickerDropdownShell
      ref={panelRef}
      data-spotlight-detail-anchor
      data-spotlight-tabs-scope
      position={panelPosition}
      preferredWidth={Math.max(420, panelPosition.width)}
    >
      <DropdownSearch
        leading={<BranchPickerTabs value={tab} onChange={setTab} />}
        containerClassName="gap-2"
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={(value) => {
          setSearchQuery(value);
          keyboard.setSelectedIndex(-1);
        }}
        placeholder={t("selectors.spotlight.placeholders.branch")}
      />

      {filteredBranches.length === 0 ? (
        <div
          className={DROPDOWN_CLASSES.optionsContainerOverlay}
          style={{ maxHeight: LIST_MAX_HEIGHT }}
        >
          <div className={DROPDOWN_CLASSES.listMessage}>
            {t(
              isLoading ? "status.loading" : "selectors.modelSelector.noResults"
            )}
          </div>
        </div>
      ) : (
        <BranchDropdownList
          items={rows}
          getKey={branchRowKey}
          estimateHeight={branchRowHeight}
          selectedIndex={keyboard.selectedIndex}
          keyboardNavigated={keyboard.keyboardNavigated}
          searchQuery={searchQuery}
          renderItem={({ branch, heading }, index) => (
            <>
              {heading && (
                <div className={DROPDOWN_CLASSES.sectionLabel}>{heading}</div>
              )}
              <BranchRow
                branch={branch}
                isCurrent={branch.name === currentBranchName}
                keyboardProps={keyboard.getItemProps(index)}
              />
            </>
          )}
        />
      )}
    </PickerDropdownShell>
  );
};

BranchDropdown.displayName = "BranchDropdown";

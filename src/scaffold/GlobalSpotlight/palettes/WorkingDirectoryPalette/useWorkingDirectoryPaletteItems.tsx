/**
 * WorkingDirectoryPalette — item model.
 *
 * Builds every `SpotlightItem` the palette lists: the sectioned add-source
 * rows, the open-path action, the pinned actions, and the main repo /
 * workspace list (with the manage-mode trash affordance), then applies the
 * user's pins and appends the pinned actions.
 */
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { repoApi } from "@src/api/tauri/repo";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import { HugeiconsIcon } from "@src/icons";
import type { CachedRepo } from "@src/store/repo";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import { ICONS } from "../../config";
import type {
  AddWorkingDirectoryModalStage,
  useAddWorkingDirectoryFlow,
} from "../../hooks";
import { usePinnedSpotlightItems } from "../../pinning/usePinnedSpotlightItems";
import type { RepoItem, SpotlightItem } from "../../types";
import { buildOpenPathItem } from "./pathActionItem";
import { buildPinnedWorkingDirectoryActions } from "./pinnedActions";
import type {
  AddMenuKind,
  WorkingDirectoryPaletteProps,
  WorkingDirectoryPaletteText,
} from "./types";
import {
  buildSectionedAddItems,
  buildSectionedWorkingDirectoryItems,
} from "./workingDirectoryPaletteItems";
import { importWorkingDirectoryPath } from "./workingDirectoryPathImport";

const log = createLogger("WorkingDirectoryPalette");

interface UseWorkingDirectoryPaletteItemsOptions extends Pick<
  WorkingDirectoryPaletteProps,
  "currentRepoId" | "leadingRepos" | "repoFilter"
> {
  searchQuery: string;
  paletteText: WorkingDirectoryPaletteText;
  workingDirectoryFlow: ReturnType<typeof useAddWorkingDirectoryFlow>;
  handleBulkDelete: () => Promise<void>;
  isManageMode: boolean;
  selectedCount: number;
  selectedIds: Set<string>;
  toggleManageMode: () => void;
  toggleSelection: (id: string) => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setAddMenuKind: (kind: AddMenuKind) => void;
  setModalStage: (stage: AddWorkingDirectoryModalStage) => void;
  refreshReposForce: () => Promise<void>;
  addMenuKind: AddMenuKind;
  workspaceItems: SpotlightItem[];
  filteredRepos: RepoItem[];
  externalRecentRepos: readonly RepoItem[];
  cachedRepos: readonly CachedRepo[];
  isMultiRoot: boolean;
  showPath: boolean;
  handleRepoSelectWithWorkspaceExit: (repoId: string, repo: RepoItem) => void;
  handleExternalRecentSelect: (repo: RepoItem) => Promise<void>;
}

export function useWorkingDirectoryPaletteItems({
  searchQuery,
  paletteText,
  workingDirectoryFlow,
  handleBulkDelete,
  isManageMode,
  selectedCount,
  selectedIds,
  toggleManageMode,
  toggleSelection,
  setSelectedIds,
  setAddMenuKind,
  setModalStage,
  refreshReposForce,
  addMenuKind,
  workspaceItems,
  filteredRepos,
  externalRecentRepos,
  cachedRepos,
  currentRepoId,
  isMultiRoot,
  leadingRepos,
  repoFilter,
  showPath,
  handleRepoSelectWithWorkspaceExit,
  handleExternalRecentSelect,
}: UseWorkingDirectoryPaletteItemsOptions) {
  const { t } = useTranslation();

  // ============ ITEMS ============
  const sectionedAddItems = useMemo(
    (): SpotlightItem[] =>
      buildSectionedAddItems(workingDirectoryFlow.addWorkingDirectoryItems),
    [workingDirectoryFlow.addWorkingDirectoryItems]
  );

  const handleRemoveRepo = useCallback(
    async (repo: RepoItem) => {
      const confirmed = await confirmDestructiveAction({
        title: t("confirmation.removeTitle", { name: repo.name }),
        message: t("confirmation.removeMessage"),
        okLabel: t("actions.removeFromOrgii", "Remove from ORG2"),
        cancelLabel: t("actions.cancel"),
      });
      if (!confirmed) return;

      try {
        await repoApi.deleteRepo(repo.id);
        await refreshReposForce();
        setSelectedIds((prev) => {
          if (!prev.has(repo.id)) return prev;
          const next = new Set(prev);
          next.delete(repo.id);
          return next;
        });
        Message.success(
          t("selectors.spotlight.toast.repoRemoved", "Linkage to ORG2 removed")
        );
      } catch (error) {
        Message.error(
          error instanceof Error
            ? error.message
            : t(
                "selectors.spotlight.toast.repoRemoveFailed",
                "Failed to remove linkage to ORG2"
              )
        );
      }
    },
    [refreshReposForce, setSelectedIds, t]
  );

  const openPathItem = useMemo(
    () =>
      buildOpenPathItem({
        searchQuery,
        addLabel: paletteText.addFolderLabel,
        onOpenPath: (candidatePath) => {
          importWorkingDirectoryPath({
            candidatePath,
            invalidPathTitle: paletteText.invalidPathTitle,
            invalidPathMessage: paletteText.invalidPathMessage,
            onImportWorkingDirectory:
              workingDirectoryFlow.workingDirectoryForm
                .handleImportWorkingDirectory,
          }).catch((error: unknown) => {
            log.warn("failed to import working directory path", {
              error,
              candidatePath,
            });
          });
        },
      }),
    [
      workingDirectoryFlow.workingDirectoryForm.handleImportWorkingDirectory,
      paletteText.invalidPathMessage,
      paletteText.invalidPathTitle,
      paletteText.addFolderLabel,
      searchQuery,
    ]
  );

  const pinnedActionItems = useMemo(
    (): SpotlightItem[] =>
      buildPinnedWorkingDirectoryActions({
        isManageMode,
        selectedCount,
        paletteText,
        t,
        onOpenWorkingDirectory: () =>
          void workingDirectoryFlow.workingDirectoryForm.handleOpenWorkingDirectory(),
        onOpenAddMenu: () => setAddMenuKind("add"),
        onCreateWorkspace: () => setModalStage("create-workspace"),
        onBulkDelete: () => void handleBulkDelete(),
        onToggleManageMode: toggleManageMode,
      }),
    [
      workingDirectoryFlow.workingDirectoryForm,
      handleBulkDelete,
      isManageMode,
      paletteText,
      selectedCount,
      setAddMenuKind,
      setModalStage,
      t,
      toggleManageMode,
    ]
  );

  const renderRepoTrashAction = useCallback(
    (repo: RepoItem): React.ReactNode => (
      <Button
        variant="tertiary"
        tone="danger"
        size="mini"
        aria-label={t("actions.removeFromOrgii", "Remove from ORG2")}
        iconOnly
        icon={<HugeiconsIcon icon={ICONS.removeRepo} size={14} />}
        onClick={(e) => {
          e.stopPropagation();
          handleRemoveRepo(repo).catch((error: unknown) => {
            log.warn("failed to remove repo", { error, repoId: repo.id });
          });
        }}
        title={t("actions.removeFromOrgii", "Remove from ORG2")}
      />
    ),
    [handleRemoveRepo, t]
  );

  const unpinnedMainItems = useMemo((): SpotlightItem[] => {
    return buildSectionedWorkingDirectoryItems({
      addMenuActive: !!addMenuKind,
      sectionedAddItems,
      workspaceItems,
      openPathItem,
      filteredRepos,
      externalRecentRepos,
      recentCachedRepos: cachedRepos,
      currentRepoId,
      isMultiRoot,
      isManageMode,
      leadingRepos,
      selectedIds,
      searchQuery,
      paletteText,
      orgScopeFilter: repoFilter ?? null,
      showPath,
      onRepoAction: (repo) => {
        if (isManageMode) {
          toggleSelection(repo.id);
        } else {
          handleRepoSelectWithWorkspaceExit(repo.id, repo);
        }
      },
      onLeadingRepoAction: (repo) => {
        if (repo.id.startsWith("external-recent:")) {
          handleExternalRecentSelect(repo).catch((error: unknown) => {
            log.warn("failed to open external recent path", {
              error,
              repoId: repo.id,
            });
          });
        } else {
          handleRepoSelectWithWorkspaceExit(repo.id, repo);
        }
      },
      toggleSelection,
      renderRepoTrashAction,
    });
  }, [
    addMenuKind,
    cachedRepos,
    currentRepoId,
    externalRecentRepos,
    filteredRepos,
    handleExternalRecentSelect,
    handleRepoSelectWithWorkspaceExit,
    isManageMode,
    isMultiRoot,
    leadingRepos,
    openPathItem,
    paletteText,
    renderRepoTrashAction,
    repoFilter,
    searchQuery,
    sectionedAddItems,
    selectedIds,
    showPath,
    toggleSelection,
    workspaceItems,
  ]);

  const mainItems = usePinnedSpotlightItems(
    unpinnedMainItems,
    "directories",
    !addMenuKind && !isManageMode
  );

  const pinnedActionStartIndex = mainItems.length;
  const items = useMemo(
    () => (addMenuKind ? mainItems : [...mainItems, ...pinnedActionItems]),
    [addMenuKind, mainItems, pinnedActionItems]
  );

  return { pinnedActionItems, mainItems, pinnedActionStartIndex, items };
}

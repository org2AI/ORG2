/**
 * WorkingDirectoryPalette Component
 *
 * Flat palette listing repos, folders, and workspaces as peers.
 * A workspace (multi-repo preset) renders as a single row showing
 * "{primary} Workspace" with a member list in the description.
 * Individual repos that belong to the active workspace are excluded
 * from the flat list to avoid duplication.
 *
 * Uses useSelectorKernel for unified state management.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSelector as useSelectorKernel } from "@src/scaffold/GlobalSpotlight/hooks/selectors/useSelector";
import { cachedReposAtom } from "@src/store/repo";
import { workingDirectoryInitialStageAtom } from "@src/store/ui/overlayAtom";
import { spotlightShowPathAtom } from "@src/store/ui/spotlightShowPathAtom";
import {
  isMultiRootWorkspaceAtom,
  setWorkspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";

import {
  SPOTLIGHT_FOOTER_ACTIVE_CHIP,
  SpotlightFooterToggle,
  SpotlightPinnedActionSection,
} from "../../components";
import {
  type AddWorkingDirectoryModalStage,
  useExternalRecentPaths,
  useSharedRepoList,
} from "../../hooks";
import { usePathSegment } from "../../hooks/usePathSegment";
import { PaletteBody, ShellFooterAction, SpotlightShell } from "../../shell";
import { AddWorkingDirectoryModalShell } from "../AddWorkingDirectoryModalShell";
import { REPO_PALETTE_CONFIG } from "../config";
import type { AddMenuKind, WorkingDirectoryPaletteProps } from "./types";
import { useWorkingDirectoryManageMode } from "./useWorkingDirectoryManageMode";
import { useWorkingDirectoryPaletteItems } from "./useWorkingDirectoryPaletteItems";
import { useWorkingDirectoryPaletteNavigation } from "./useWorkingDirectoryPaletteNavigation";
import { useWorkingDirectoryPaletteOpenReset } from "./useWorkingDirectoryPaletteOpenReset";
import { useWorkingDirectoryPaletteSectionTab } from "./useWorkingDirectoryPaletteSectionTab";
import { useWorkingDirectoryPaletteSelection } from "./useWorkingDirectoryPaletteSelection";
import { useWorkingDirectoryPaletteText } from "./useWorkingDirectoryPaletteText";
import { useWorkingDirectoryPaletteWorkspaces } from "./useWorkingDirectoryPaletteWorkspaces";

// ============ COMPONENT ============

export const WorkingDirectoryPalette: React.FC<
  WorkingDirectoryPaletteProps
> = ({
  isOpen,
  onClose,
  onSelect,
  currentRepoId,
  initialAddStage: initialAddStageProp,
  initialAddMenu = false,
  initialManageMode = false,
  topSlot,
  asBody = false,
  switchPathLabel,
  hideActionClose = false,
  leadingRepos = [],
  repoFilter,
  orgScopeName,
  onGoBackToParent,
}) => {
  const { t } = useTranslation();

  // ============ GLOBAL STATE ============
  const [initialAddStageAtom, setInitialAddStageAtom] = useAtom(
    workingDirectoryInitialStageAtom
  );
  const [showPath, setShowPath] = useAtom(spotlightShowPathAtom);
  const effectiveInitialStage = initialAddStageProp ?? initialAddStageAtom;

  // ============ LOCAL STATE ============
  const [searchQuery, setSearchQuery] = useState("");
  const [modalStage, setModalStage] = useState<AddWorkingDirectoryModalStage>(
    effectiveInitialStage ?? null
  );
  const [addMenuKind, setAddMenuKind] = useState<AddMenuKind>(
    effectiveInitialStage ? null : initialAddMenu ? "add" : null
  );
  const {
    isManageMode,
    setIsManageMode,
    selectedIds,
    setSelectedIds,
    selectedCount,
    toggleManageMode,
    toggleSelection,
    clearSelection,
  } = useWorkingDirectoryManageMode({ initialManageMode, setSearchQuery });

  const paletteText = useWorkingDirectoryPaletteText({
    isManageMode,
    switchPathLabel,
    orgScopeName,
  });

  useWorkingDirectoryPaletteOpenReset({
    isOpen,
    effectiveInitialStage,
    initialAddMenu,
    initialManageMode,
    initialAddStageAtom,
    setInitialAddStageAtom,
    setSearchQuery,
    setModalStage,
    setAddMenuKind,
    setIsManageMode,
    setSelectedIds,
  });

  // ============ DATA ============
  const { repos, filteredRepos, repoLoading, refreshReposForce } =
    useSharedRepoList(searchQuery);
  const cachedRepos = useAtomValue(cachedReposAtom);

  const existingRepoPaths = useMemo(
    () => repos.map((repo) => repo.fs_uri ?? "").filter(Boolean),
    [repos]
  );

  const { recentPathRepos: externalRecentRepos } = useExternalRecentPaths({
    enabled: isOpen && !isManageMode,
    existingRepoPaths,
    searchQuery,
  });

  // ============ MULTI-ROOT WORKSPACE ============
  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const dispatchSetFolders = useSetAtom(setWorkspaceFoldersAtom);

  const {
    handleRepoSelectWithWorkspaceExit,
    workingDirectoryFlow,
    handleExternalRecentSelect,
  } = useWorkingDirectoryPaletteSelection({
    isMultiRoot,
    dispatchSetFolders,
    onSelect,
    onClose,
    modalStage,
    setModalStage,
    refreshReposForce,
  });

  // ============ WORKSPACE MANAGEMENT ============
  const { workspaceItems, handleBulkDelete } =
    useWorkingDirectoryPaletteWorkspaces({
      repos,
      isManageMode,
      selectedIds,
      toggleSelection,
      clearSelection,
      setModalStage,
      onClose,
      refreshReposForce,
      searchQuery,
      repoFilter,
      setEditingWorkspace:
        workingDirectoryFlow.multiRepoWorkspaceForm.setEditingWorkspace,
    });

  const addPathSegment = usePathSegment(
    REPO_PALETTE_CONFIG.modes?.find((mode) => mode.id === "add")?.path,
    {
      labelOverride: paletteText.addPathLabel,
      templateOverride: paletteText.addPathTemplate,
    }
  );

  const switchPathSegment = usePathSegment(
    REPO_PALETTE_CONFIG.modes?.find((mode) => mode.id === "switch")?.path,
    {
      labelOverride: paletteText.switchPathLabel,
      templateOverride: paletteText.switchPathTemplate,
    }
  );

  // ============ ITEMS ============
  const { pinnedActionItems, mainItems, pinnedActionStartIndex, items } =
    useWorkingDirectoryPaletteItems({
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
    });

  // ============ KERNEL ============
  const { isItemSelectable, handleSectionTab } =
    useWorkingDirectoryPaletteSectionTab({
      addMenuActive: !!addMenuKind,
      mainItems,
      pinnedActionCount: pinnedActionItems.length,
      pinnedActionStartIndex,
    });

  const { handleGoBack, handleExternalKeyDown } =
    useWorkingDirectoryPaletteNavigation({
      modalStage,
      addMenuKind,
      asBody,
      effectiveInitialStage,
      initialAddMenu,
      onClose,
      onGoBackToParent,
      setModalStage,
      setAddMenuKind,
      setSearchQuery,
      workingDirectoryFlow,
      searchQuery,
      paletteText,
    });

  const kernel = useSelectorKernel({
    isOpen,
    onClose,
    items,
    isItemSelectable,
    hasModalState:
      !!modalStage || !!addMenuKind || asBody || !!onGoBackToParent,
    onGoBack: handleGoBack,
    onReset: () => {
      setSearchQuery("");
      if (effectiveInitialStage) {
        setModalStage(effectiveInitialStage);
        setAddMenuKind(null);
        return;
      }
      if (initialAddMenu) {
        setModalStage(null);
        setAddMenuKind("add");
        return;
      }
      setModalStage(null);
      setAddMenuKind(null);
    },
    externalSearchQuery: searchQuery,
    externalSetSearchQuery: setSearchQuery,
    externalHandleKeyDown: handleExternalKeyDown,
    onTab: handleSectionTab,
  });

  // ============ RENDER: MODAL VIEW ============
  if (modalStage && modalStage !== "add-workspace-existing") {
    return (
      <AddWorkingDirectoryModalShell
        isOpen={isOpen}
        onClose={onClose}
        modalStage={modalStage}
        workingDirectoryFlow={workingDirectoryFlow}
        currentRepoId={currentRepoId}
        onGoBack={handleGoBack}
        asBody={asBody}
      />
    );
  }

  // ============ RENDER: PINNED ACTIONS ============
  const pinnedActionSection = addMenuKind ? undefined : (
    <SpotlightPinnedActionSection
      items={pinnedActionItems}
      startIndex={pinnedActionStartIndex}
      selectedIndex={kernel.selectedIndex}
      onItemSelect={kernel.handleItemClick}
      onItemHover={kernel.setSelectedIndex}
      searchQuery={searchQuery}
      layout="twoColumn"
    />
  );

  const handleRemovePathSegment = () => {
    if (addMenuKind) {
      setAddMenuKind(null);
      setSearchQuery("");
      return;
    }

    if (isManageMode) {
      toggleManageMode();
      return;
    }

    handleGoBack();
  };

  // ============ RENDER: MAIN VIEW ============
  // Portals next to the shell's keyboard-hint footer (and renders nothing
  // when the palette is embedded without a shell). The add menu lists
  // sources rather than repos, so it gets no path toggle.
  const showPathToggle = addMenuKind ? null : (
    <ShellFooterAction placement="inline">
      <SpotlightFooterToggle
        label={t("selectors.spotlightFooter.showPath", "Show path")}
        checked={showPath}
        onCheckedChange={setShowPath}
      />
    </ShellFooterAction>
  );

  const body = (
    <PaletteBody
      kernel={kernel}
      items={mainItems}
      placeholder={
        addMenuKind ? paletteText.addPlaceholder : paletteText.switchPlaceholder
      }
      path={
        addMenuKind ? addPathSegment : isManageMode ? switchPathSegment : []
      }
      onRemoveSegment={handleRemovePathSegment}
      isLoading={repoLoading}
      hideActionClose={hideActionClose && !addMenuKind && !isManageMode}
      containerHeight={350}
      topSlot={addMenuKind ? undefined : topSlot}
      afterListSlot={pinnedActionSection}
    />
  );

  const palette = (
    <>
      {body}
      {showPathToggle}
    </>
  );

  if (asBody) return palette;

  return (
    <SpotlightShell
      isOpen={isOpen}
      onClose={onClose}
      hasActiveAction={!addMenuKind && pinnedActionItems.length > 0}
      activeActionChip={SPOTLIGHT_FOOTER_ACTIVE_CHIP.switchSection}
      pinScope="directories"
    >
      {palette}
    </SpotlightShell>
  );
};

WorkingDirectoryPalette.displayName = "WorkingDirectoryPalette";

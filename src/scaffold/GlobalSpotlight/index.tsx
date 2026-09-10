/**
 * GlobalSpotlight Component (NEW ARCHITECTURE)
 *
 * Command palette with reducer-based state management.
 * Modularized for better maintainability.
 */
import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import ImportSharedSessionDialog from "@src/features/Org2Cloud/ImportSharedSessionDialog";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useSelector as useSelectorKernel } from "@src/scaffold/GlobalSpotlight/hooks/selectors/useSelector";
import { currentBranchAtom } from "@src/store/repo";
import {
  activeWorktreeAtom,
  setActiveWorktreeAtom,
} from "@src/store/workspace";

import { SPOTLIGHT_FOOTER_ACTIVE_CHIP } from "./components";
import CollabOrgForm from "./forms/CollabOrg/CollabOrgForm";
import GitHubIssuesImportForm from "./forms/GitHubIssuesImport/GitHubIssuesImportForm";
import { getEditorPaletteMode } from "./globalSpotlight.helpers";
import {
  type AddWorkingDirectoryModalStage,
  SpotlightProvider,
  useSpotlight,
  useSpotlightEffects,
} from "./hooks";
import { useSpotlightOverlayLayers } from "./hooks/features/useSpotlightOverlayLayers";
import { useSpotlightPickerActions } from "./hooks/features/useSpotlightPickerActions";
import {
  AgentControlPalette,
  AgentSessionSearchPalette,
  AllSessionsSearchPalette,
  BranchPalette,
  EditorPalette,
  SessionCreatorPalette,
  WorkingDirectoryPalette,
  WorktreePalette,
} from "./palettes";
import { PaletteBody, SpotlightShell } from "./shell";
import type { GlobalSpotlightProps } from "./types";
import { SpotlightConfirmationView } from "./views";

// ============================================
// INNER COMPONENT
// ============================================

const GlobalSpotlightInner: React.FC<
  GlobalSpotlightProps & { isOpen: boolean; closeModal: () => void }
> = (props) => {
  const { isOpen, closeModal } = props;

  const { t } = useTranslation();
  const location = useLocation();
  const {
    selectedRepoId,
    currentRepo,
    repos,
    currentBranch: selectedBranchName,
    selectRepo,
    selectBranch,
    refreshBranches,
  } = useRepoSelection({ autoLoad: false });
  const activeWorktree = useAtomValue(activeWorktreeAtom);
  const setActiveWorktree = useSetAtom(setActiveWorktreeAtom);
  const setCurrentBranch = useSetAtom(currentBranchAtom);

  const isWorkStationRoute = location.pathname.startsWith(
    ROUTES.workStation.base.path
  );
  const isEditorRoute = location.pathname.startsWith(
    ROUTES.workStation.code.path
  );
  const currentRepoPath = currentRepo?.path ?? currentRepo?.fs_uri ?? "";

  const {
    workingDirectoryPickerMode,
    setWorkingDirectoryPickerMode,
    collabOrgContext,
    githubIssuesImportContext,
    embeddedBranchMode,
    setEmbeddedBranchMode,
    setEmbeddedWorktreeMode,
    branchPickerOpen,
    setBranchPickerOpen,
    worktreePickerOpen,
    setWorktreePickerOpen,
    agentSessionSearchOpen,
    allSessionsSearchOpen,
    agentControlOpen,
    sessionCreatorOpen,
    sessionImportOpen,
    embeddedEditorPalette,
    lastActivatedItemIdRef,
    pendingRestoreItemId,
    setPendingRestoreItemId,
    restoreLastActivatedItem,
    handleOpenWorkingDirectoryPicker,
    handleOpenCollabOrg,
    handleOpenGitHubIssuesImport,
    handleOpenBranchPicker,
    handleOpenWorktreePicker,
    handleOpenAgentSessionSearch,
    handleOpenAllSessionsSearch,
    handleOpenAgentControl,
    handleOpenSessionCreator,
    handleOpenSessionImport,
    handleOpenEditorPalette,
    handleCloseWorkingDirectoryPicker,
    handleCloseCollabOrg,
    handleCloseGitHubIssuesImport,
    handleCloseBranchPicker,
    handleCloseWorktreePicker,
    handleCloseAgentSessionSearch,
    handleCloseAllSessionsSearch,
    handleCloseAgentControl,
    handleCloseSessionCreator,
    handleCloseSessionImport,
    handleCloseEditorPalette,
  } = useSpotlightOverlayLayers(isOpen);

  const {
    handleWorkspaceSelect,
    handleWorktreePickerSelect,
    handleWorktreePickerCreate,
    handleBranchPickerSelect,
    handleCreateBranch,
    handleDeleteBranch,
    handleRemoveWorktree,
    handleCheckoutDetached,
  } = useSpotlightPickerActions({
    selectedRepoId,
    currentRepo,
    currentRepoPath,
    selectRepo,
    selectBranch,
    refreshBranches,
    closeModal,
    t,
    setActiveWorktree,
    setCurrentBranch,
    setWorkingDirectoryPickerMode,
    setBranchPickerOpen,
    setWorktreePickerOpen,
  });

  const handleOpenRepoBranchPicker = useCallback(
    (repoId?: string) => {
      if (repoId) {
        if (!repos.some((repo) => repo.id === repoId && repo.kind === "git"))
          return;
        if (repoId !== selectedRepoId) selectRepo(repoId);
      }
      handleOpenBranchPicker();
    },
    [handleOpenBranchPicker, repos, selectRepo, selectedRepoId]
  );

  // ============ ALL HOOKS MUST BE CALLED UNCONDITIONALLY ============
  // These hooks are needed for normal mode, but must always be called
  // to satisfy React's rules of hooks (same order every render)
  const spotlight = useSpotlight({
    ...props,
    closeModal,
    onOpenWorkingDirectoryPicker: handleOpenWorkingDirectoryPicker,
    onOpenBranchPicker: handleOpenRepoBranchPicker,
    onOpenEditorPalette: handleOpenEditorPalette,
    onOpenAgentSessionSearch: handleOpenAgentSessionSearch,
    onOpenAllSessionsSearch: handleOpenAllSessionsSearch,
    isEditorRoute,
    isWorkStationRoute,
    currentRepoId: selectedRepoId || currentRepo?.id,
  });
  const { dispatch: spotlightDispatch, state: spotlightState } = spotlight;
  const activeEditorPalette = embeddedEditorPalette;

  useSpotlightEffects({
    isOpen:
      isOpen &&
      !workingDirectoryPickerMode &&
      !collabOrgContext &&
      !githubIssuesImportContext &&
      !branchPickerOpen &&
      !worktreePickerOpen &&
      !agentSessionSearchOpen &&
      !allSessionsSearchOpen &&
      !agentControlOpen &&
      !sessionImportOpen &&
      !sessionCreatorOpen,
    dispatch: spotlightDispatch,
    closeModal,
    onOpenWorkingDirectoryLayer: handleOpenWorkingDirectoryPicker,
    onOpenCollabOrgLayer: handleOpenCollabOrg,
    onOpenGitHubIssuesImportLayer: handleOpenGitHubIssuesImport,
    onOpenBranchLayer: handleOpenRepoBranchPicker,
    onOpenWorktreeLayer: handleOpenWorktreePicker,
    onOpenEditorLayer: handleOpenEditorPalette,
    onOpenAgentSessionSearchLayer: handleOpenAgentSessionSearch,
    onOpenAllSessionsSearchLayer: handleOpenAllSessionsSearch,
    onOpenAgentControlLayer: handleOpenAgentControl,
    onOpenSessionCreatorLayer: handleOpenSessionCreator,
    onOpenSessionImportLayer: handleOpenSessionImport,
  });

  // Default view kernel — same hook every palette uses. Owns the input
  // ref, auto-focus, selectedIndex, and keyboard navigation. The reducer
  // remains the source of truth for searchQuery and path; the default view
  // bridges them through the kernel's external* options.
  const pathLength = spotlightState.path.length;
  const handleGoBack = useCallback(() => {
    if (pathLength === 1) {
      restoreLastActivatedItem();
    }
    spotlightDispatch({ type: "POP_SEGMENT" });
  }, [pathLength, restoreLastActivatedItem, spotlightDispatch]);
  const handleSetSearchQuery = useCallback(
    (query: string) => {
      const mode = getEditorPaletteMode(query);
      if (pathLength === 0 && isEditorRoute && mode === "symbol") {
        spotlightDispatch({ type: "SET_SEARCH_QUERY", payload: { query: "" } });
        handleOpenEditorPalette(query, mode);
        return;
      }

      spotlightDispatch({ type: "SET_SEARCH_QUERY", payload: { query } });
    },
    [handleOpenEditorPalette, isEditorRoute, pathLength, spotlightDispatch]
  );
  const handleExternalKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLInputElement>,
      internal: (e: React.KeyboardEvent<HTMLInputElement>) => void
    ) => {
      // Escape with an active path clears the path instead of closing.
      if (event.key === "Escape" && pathLength > 0) {
        event.preventDefault();
        restoreLastActivatedItem();
        spotlightDispatch({ type: "CLEAR_PATH" });
        return;
      }
      internal(event);
    },
    [restoreLastActivatedItem, spotlightDispatch, pathLength]
  );
  const defaultKernel = useSelectorKernel({
    isOpen:
      isOpen &&
      !branchPickerOpen &&
      !worktreePickerOpen &&
      !agentSessionSearchOpen &&
      !allSessionsSearchOpen &&
      !agentControlOpen &&
      !sessionImportOpen &&
      !sessionCreatorOpen &&
      !activeEditorPalette,
    onClose: closeModal,
    items: spotlight.items,
    hasModalState: pathLength > 0,
    onGoBack: handleGoBack,
    externalSearchQuery: spotlightState.searchQuery,
    externalSetSearchQuery: handleSetSearchQuery,
    isItemSelectable: (item) => !item.data?.isHeader && !item.data?.disabled,
    onActivateItem: (item) => {
      if (pathLength === 0) {
        lastActivatedItemIdRef.current = item.id;
      }
    },
    externalHandleKeyDown: handleExternalKeyDown,
  });
  const setDefaultSelectedIndex = defaultKernel.setSelectedIndex;

  useEffect(() => {
    if (
      workingDirectoryPickerMode ||
      collabOrgContext ||
      githubIssuesImportContext ||
      branchPickerOpen ||
      worktreePickerOpen ||
      agentSessionSearchOpen ||
      allSessionsSearchOpen ||
      agentControlOpen ||
      sessionImportOpen ||
      sessionCreatorOpen ||
      !pendingRestoreItemId
    ) {
      return;
    }

    const entryIndex = spotlight.items.findIndex(
      (item) => item.id === pendingRestoreItemId
    );
    if (entryIndex < 0) return;

    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setDefaultSelectedIndex(entryIndex);
      setPendingRestoreItemId(null);
    });

    return () => {
      cancelled = true;
    };
  }, [
    pendingRestoreItemId,
    setDefaultSelectedIndex,
    setPendingRestoreItemId,
    spotlight.items,
    workingDirectoryPickerMode,
    collabOrgContext,
    githubIssuesImportContext,
    branchPickerOpen,
    worktreePickerOpen,
    agentSessionSearchOpen,
    allSessionsSearchOpen,
    agentControlOpen,
    sessionCreatorOpen,
    sessionImportOpen,
  ]);

  // ============ NORMAL MODE ============

  // ============ RENDER HELPERS ============
  const getPlaceholder = (): string => {
    if (spotlight.state.stage === "confirming") return "";
    if (spotlight.state.path.length === 0) {
      return t("selectors.spotlight.placeholder");
    }

    switch (spotlight.state.missingParam) {
      case "repo":
        return t("selectors.spotlight.placeholders.workspace");
      case "branch":
        return t("selectors.spotlight.placeholders.branch");
      case "source":
        return t("selectors.spotlight.placeholders.source");
      case "language":
        return t("settings:general.languageSearchPlaceholder");
      case "theme":
        return t("common:spotlightActions.searchThemes");
      case "skin":
        return t("common:spotlightActions.searchSkins");
      default:
        return t("selectors.spotlight.placeholders.actions");
    }
  };

  // ============ EARLY RETURN ============
  if (!isOpen) return null;

  // ============ CONFIRMATION PAGE ============
  // Confirmation takes over the entire shell (no footer, no palette body).
  const showConfirmation =
    spotlight.confirmationPage.showConfirmation &&
    spotlight.confirmationPage.confirmationData;

  // Single SpotlightShell wraps the whole normal-mode tree.
  const hasActiveAction =
    !!workingDirectoryPickerMode ||
    !!collabOrgContext ||
    !!githubIssuesImportContext ||
    branchPickerOpen ||
    worktreePickerOpen ||
    agentSessionSearchOpen ||
    allSessionsSearchOpen ||
    agentControlOpen ||
    sessionImportOpen ||
    sessionCreatorOpen ||
    !!activeEditorPalette ||
    spotlight.state.path.length > 0;
  const effectiveCurrentRepoId = selectedRepoId || undefined;
  const initialWorkingDirectoryStage: AddWorkingDirectoryModalStage =
    workingDirectoryPickerMode === "create"
      ? "create-workspace"
      : workingDirectoryPickerMode === "open"
        ? "add-workspace-existing"
        : null;
  // Tab keeps switching between the list and the pinned action section in
  // every mode that still renders one, so the hint chip must not flip to
  // "Back" the moment a palette drills into remove mode — the footer would
  // resize under the user mid-interaction. The branch palette's create
  // modes are the exception: they render no pinned section at all.
  const activeActionChip =
    workingDirectoryPickerMode === "switch" ||
    worktreePickerOpen ||
    (branchPickerOpen &&
      (embeddedBranchMode === "checkout" || embeddedBranchMode === "remove"))
      ? SPOTLIGHT_FOOTER_ACTIVE_CHIP.switchSection
      : undefined;

  const body = collabOrgContext ? (
    <CollabOrgForm
      key={`${collabOrgContext.source ?? "choose"}:${collabOrgContext.mode ?? "choose"}`}
      initialSource={collabOrgContext.source}
      initialMode={collabOrgContext.mode}
      onCancel={handleCloseCollabOrg}
      onCompleted={closeModal}
    />
  ) : githubIssuesImportContext ? (
    <GitHubIssuesImportForm
      orgId={githubIssuesImportContext.orgId}
      repoName={githubIssuesImportContext.repoName ?? currentRepo?.name}
      repoPath={githubIssuesImportContext.repoPath ?? currentRepoPath}
      repoUrl={githubIssuesImportContext.repoUrl ?? currentRepo?.repo_url}
      onCancel={handleCloseGitHubIssuesImport}
      onImported={closeModal}
    />
  ) : workingDirectoryPickerMode ? (
    <WorkingDirectoryPalette
      key={workingDirectoryPickerMode}
      isOpen={isOpen}
      onClose={closeModal}
      onGoBackToParent={handleCloseWorkingDirectoryPicker}
      onSelect={handleWorkspaceSelect}
      currentRepoId={effectiveCurrentRepoId}
      initialAddMenu={workingDirectoryPickerMode === "add"}
      initialAddStage={initialWorkingDirectoryStage}
      asBody
    />
  ) : branchPickerOpen ? (
    <BranchPalette
      isOpen={isOpen}
      onClose={closeModal}
      onGoBackToParent={handleCloseBranchPicker}
      onSelect={handleBranchPickerSelect}
      onCreateBranch={handleCreateBranch}
      onDeleteBranch={handleDeleteBranch}
      onCheckoutDetached={handleCheckoutDetached}
      repoId={effectiveCurrentRepoId ?? ""}
      repoPath={
        activeWorktree && activeWorktree.repoId === effectiveCurrentRepoId
          ? activeWorktree.path
          : currentRepoPath
      }
      repoName={currentRepo?.name}
      currentBranchName={selectedBranchName}
      asBody
      onModeChange={setEmbeddedBranchMode}
    />
  ) : worktreePickerOpen ? (
    <WorktreePalette
      isOpen={isOpen}
      onClose={closeModal}
      onGoBackToParent={handleCloseWorktreePicker}
      onSelect={handleWorktreePickerSelect}
      onCreate={handleWorktreePickerCreate}
      onRemoveWorktree={handleRemoveWorktree}
      onModeChange={setEmbeddedWorktreeMode}
      repoId={effectiveCurrentRepoId ?? ""}
      repoPath={currentRepoPath}
      activePath={activeWorktree?.path ?? currentRepoPath}
      asBody
    />
  ) : agentSessionSearchOpen ? (
    <AgentSessionSearchPalette
      isOpen={isOpen}
      onClose={closeModal}
      onGoBackToParent={handleCloseAgentSessionSearch}
      asBody
    />
  ) : allSessionsSearchOpen ? (
    <AllSessionsSearchPalette
      isOpen={isOpen}
      onClose={closeModal}
      onGoBackToParent={handleCloseAllSessionsSearch}
      asBody
    />
  ) : agentControlOpen ? (
    <AgentControlPalette
      isOpen={isOpen}
      onClose={closeModal}
      onGoBackToParent={handleCloseAgentControl}
      asBody
    />
  ) : sessionImportOpen ? (
    <ImportSharedSessionDialog
      visible={isOpen}
      onClose={closeModal}
      onGoBack={handleCloseSessionImport}
      asBody
    />
  ) : sessionCreatorOpen ? (
    <SessionCreatorPalette
      isOpen={isOpen}
      onClose={closeModal}
      onGoBackToParent={handleCloseSessionCreator}
      asBody
    />
  ) : activeEditorPalette ? (
    <EditorPalette
      key={activeEditorPalette.query}
      isOpen={isOpen}
      onClose={closeModal}
      repoPath={currentRepoPath}
      initialMode={activeEditorPalette.mode}
      initialQuery={activeEditorPalette.query}
      onGoBackToParent={handleCloseEditorPalette}
      hideFileModeHints={activeEditorPalette.mode === "file"}
      asBody
    />
  ) : showConfirmation ? (
    <SpotlightConfirmationView confirmationPage={spotlight.confirmationPage} />
  ) : (
    <PaletteBody
      kernel={defaultKernel}
      items={spotlight.items}
      placeholder={getPlaceholder()}
      path={spotlight.state.path}
      onRemoveSegment={(index) => {
        if (index === 0) {
          restoreLastActivatedItem();
        }
        spotlight.dispatch({ type: "TRUNCATE_PATH", payload: { index } });
      }}
      containerHeight={400}
    />
  );

  return (
    <SpotlightShell
      isOpen={isOpen}
      onClose={closeModal}
      hasActiveAction={hasActiveAction}
      activeActionChip={activeActionChip}
      hideFooter={
        !!showConfirmation ||
        agentControlOpen ||
        sessionCreatorOpen ||
        sessionImportOpen
      }
    >
      {body}
    </SpotlightShell>
  );
};

// ============================================
// MAIN COMPONENT WITH PROVIDER
// ============================================

export const GlobalSpotlight: React.FC<GlobalSpotlightProps> = (props) => {
  const { isOpen: externalIsOpen, onClose: onCloseFromParent } = props;

  const [isModalOpen, setIsModalOpen] = useState(false);

  // Determine actual open state — parent controls visibility when provided.
  const isOpen = externalIsOpen !== undefined ? externalIsOpen : isModalOpen;

  const closeModal = useCallback(() => {
    if (onCloseFromParent) {
      onCloseFromParent();
      return;
    }
    setIsModalOpen(false);
  }, [onCloseFromParent]);

  return (
    <SpotlightProvider>
      <GlobalSpotlightInner
        {...props}
        isOpen={isOpen}
        closeModal={closeModal}
      />
    </SpotlightProvider>
  );
};

export default GlobalSpotlight;

// ============================================
// EXPORTS
// ============================================

export { WorkingDirectoryPalette, BranchPalette } from "./palettes";

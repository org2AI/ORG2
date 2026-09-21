/**
 * GlobalSpotlight command palette
 *
 * Command palette with reducer-based state management.
 * Modularized for better maintainability.
 */
import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import ImportSharedSessionDialog from "@src/features/Org2Cloud/ImportSharedSessionDialog";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useSelector as useSelectorKernel } from "@src/scaffold/GlobalSpotlight/hooks/selectors/useSelector";
import { currentBranchAtom } from "@src/store/repo";
import type {
  SpotlightInitialLayer,
  SpotlightInitialQuery,
} from "@src/store/ui/uiAtom";
import {
  activeWorktreeAtom,
  setActiveWorktreeAtom,
} from "@src/store/workspace";

import { SPOTLIGHT_FOOTER_ACTIVE_CHIP } from "./components";
import CollabOrgForm from "./forms/CollabOrg/CollabOrgForm";
import GitHubIssuesImportForm from "./forms/GitHubIssuesImport/GitHubIssuesImportForm";
import { getEditorPaletteMode } from "./globalSpotlight.helpers";
import type { WorkingDirectoryPickerMode } from "./globalSpotlight.helpers";
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
import type { EditorPaletteMode } from "./palettes/EditorPalette/types";
import { PaletteBody, SpotlightShell } from "./shell";
import type { GlobalSpotlightProps } from "./types";

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
    activeLayer: layer,
    editorQuery,
    openLayer,
    closeLayer,
    isRootActive,
    embeddedBranchMode,
    setEmbeddedBranchMode,
    lastActivatedItemIdRef,
    pendingRestoreItemId,
    setPendingRestoreItemId,
    restoreLastActivatedItem,
  } = useSpotlightOverlayLayers(isOpen);
  const handleOpenLayer = useCallback(
    (next: SpotlightInitialLayer, query = "") => {
      if (next.kind === "branch" && next.repoId) {
        if (
          !repos.some((repo) => repo.id === next.repoId && repo.kind === "git")
        )
          return;
        if (next.repoId !== selectedRepoId) selectRepo(next.repoId);
      }
      openLayer(next, query);
    },
    [openLayer, repos, selectRepo, selectedRepoId]
  );
  const handleRequest = useCallback(
    (request: SpotlightInitialQuery) => {
      handleOpenLayer(request.layer ?? { kind: "default" }, request.query);
    },
    [handleOpenLayer]
  );
  const handleOpenWorkingDirectoryPicker = useCallback(
    (mode: WorkingDirectoryPickerMode) =>
      handleOpenLayer({ kind: "workspace", mode }),
    [handleOpenLayer]
  );
  const handleOpenRepoBranchPicker = useCallback(
    (repoId?: string) => handleOpenLayer({ kind: "branch", repoId }),
    [handleOpenLayer]
  );
  const handleOpenEditorPalette = useCallback(
    (query: string, mode?: EditorPaletteMode) =>
      handleOpenLayer(
        { kind: "editor", mode: mode ?? getEditorPaletteMode(query) },
        query
      ),
    [handleOpenLayer]
  );
  const handleOpenAgentSessionSearch = useCallback(
    () => handleOpenLayer({ kind: "agentSessionSearch" }),
    [handleOpenLayer]
  );
  const handleOpenAllSessionsSearch = useCallback(
    () => handleOpenLayer({ kind: "allSessionsSearch" }),
    [handleOpenLayer]
  );

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
    setActiveWorktree,
    setCurrentBranch,
  });

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

  useSpotlightEffects({
    isOpen,
    dispatch: spotlightDispatch,
    onRequest: handleRequest,
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
        spotlightDispatch({ type: "RESET" });
        return;
      }
      internal(event);
    },
    [restoreLastActivatedItem, spotlightDispatch, pathLength]
  );
  const defaultKernel = useSelectorKernel({
    isOpen: isRootActive,
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
    if (!isRootActive || !pendingRestoreItemId) return;

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
    isRootActive,
  ]);

  // ============ NORMAL MODE ============

  // ============ RENDER HELPERS ============
  const getPlaceholder = (): string => {
    if (spotlight.state.path.length === 0) {
      return t("selectors.spotlight.placeholder");
    }

    switch (spotlight.state.missingParam) {
      case "repo":
        return t("selectors.spotlight.placeholders.workspace");
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

  const hasActiveAction = !isRootActive || spotlight.state.path.length > 0;
  const workingDirectoryPickerMode =
    layer.kind === "workspace" ? layer.mode : null;
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
    layer.kind === "worktree" ||
    (layer.kind === "branch" &&
      (embeddedBranchMode === "checkout" || embeddedBranchMode === "remove"))
      ? SPOTLIGHT_FOOTER_ACTIVE_CHIP.switchSection
      : undefined;

  const renderBody = () => {
    switch (layer.kind) {
      case "collabOrg":
        return (
          <CollabOrgForm
            key={`${(layer.context ?? {}).source ?? "choose"}:${(layer.context ?? {}).mode ?? "choose"}`}
            initialSource={(layer.context ?? {}).source}
            initialMode={(layer.context ?? {}).mode}
            onCancel={closeLayer}
            onCompleted={closeModal}
          />
        );
      case "githubIssuesImport":
        return (
          <GitHubIssuesImportForm
            orgId={(layer.context ?? {}).orgId}
            repoName={(layer.context ?? {}).repoName ?? currentRepo?.name}
            repoPath={(layer.context ?? {}).repoPath ?? currentRepoPath}
            repoUrl={(layer.context ?? {}).repoUrl ?? currentRepo?.repo_url}
            onCancel={closeLayer}
            onImported={closeModal}
          />
        );
      case "workspace":
        return (
          <WorkingDirectoryPalette
            key={workingDirectoryPickerMode}
            isOpen={isOpen}
            onClose={closeModal}
            onGoBackToParent={closeLayer}
            onSelect={handleWorkspaceSelect}
            currentRepoId={effectiveCurrentRepoId}
            initialAddMenu={workingDirectoryPickerMode === "add"}
            initialAddStage={initialWorkingDirectoryStage}
            asBody
          />
        );
      case "branch":
        return (
          <BranchPalette
            isOpen={isOpen}
            onClose={closeModal}
            onGoBackToParent={closeLayer}
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
        );
      case "worktree":
        return (
          <WorktreePalette
            isOpen={isOpen}
            onClose={closeModal}
            onGoBackToParent={closeLayer}
            onSelect={handleWorktreePickerSelect}
            onCreate={handleWorktreePickerCreate}
            onRemoveWorktree={handleRemoveWorktree}
            repoId={effectiveCurrentRepoId ?? ""}
            repoPath={currentRepoPath}
            activePath={activeWorktree?.path ?? currentRepoPath}
            asBody
          />
        );
      case "agentSessionSearch":
        return (
          <AgentSessionSearchPalette
            isOpen={isOpen}
            onClose={closeModal}
            onGoBackToParent={closeLayer}
            asBody
          />
        );
      case "allSessionsSearch":
        return (
          <AllSessionsSearchPalette
            isOpen={isOpen}
            onClose={closeModal}
            onGoBackToParent={closeLayer}
            asBody
          />
        );
      case "agentControl":
        return (
          <AgentControlPalette
            isOpen={isOpen}
            onClose={closeModal}
            onGoBackToParent={closeLayer}
            asBody
          />
        );
      case "sessionImport":
        return (
          <ImportSharedSessionDialog
            visible={isOpen}
            onClose={closeModal}
            onGoBack={closeLayer}
            asBody
          />
        );
      case "sessionCreator":
        return (
          <SessionCreatorPalette
            isOpen={isOpen}
            onClose={closeModal}
            onGoBackToParent={closeLayer}
            asBody
          />
        );
      case "editor":
        return (
          <EditorPalette
            key={`${layer.mode ?? "file"}:${editorQuery}`}
            isOpen={isOpen}
            onClose={closeModal}
            repoPath={currentRepoPath}
            initialMode={layer.mode}
            initialQuery={editorQuery}
            onGoBackToParent={closeLayer}
            hideFileModeHints={layer.mode === "file"}
            asBody
          />
        );
      case "default":
        return (
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
      default:
        layer satisfies never;
        return null;
    }
  };

  return (
    <SpotlightShell
      isOpen={isOpen}
      onClose={closeModal}
      hasActiveAction={hasActiveAction}
      activeActionChip={activeActionChip}
      pinScope={
        layer.kind === "default"
          ? "commands"
          : layer.kind === "workspace"
            ? "directories"
            : undefined
      }
      hideFooter={
        layer.kind === "agentControl" ||
        layer.kind === "sessionCreator" ||
        layer.kind === "sessionImport"
      }
    >
      {renderBody()}
    </SpotlightShell>
  );
};

// ============================================
// MAIN COMPONENT WITH PROVIDER
// ============================================

export const GlobalSpotlight: React.FC<GlobalSpotlightProps> = (props) => {
  const { isOpen, onClose: closeModal } = props;

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

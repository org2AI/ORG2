/**
 * SessionInfoLine Component
 *
 * Displays session configuration summary as a shared `PillGroup`:
 *   "[repo] | [location] | [branch]"  (resting, no border)
 * Hovering a segment promotes it to an independent pill and hides the
 * adjacent divider; the other segment stays transparent.
 *
 * Supports two repo-click modes via props:
 * - onRepoChange (switch): switches the Human Station workspace
 * - onRepoSelect (session-only): picks a repo for session creation only.
 *   Repo switch immediately also switches the Human Station workspace;
 *   branch is kept as-is (last used / checked-out).
 */
import { useAtomValue } from "jotai";
import React, { useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import RunningLocationDropdownPanel from "@src/components/RunningLocationDropdownPanel";
import {
  isSystemHomeRepoItem,
  isSystemPathRepoItem,
} from "@src/features/SessionCreator/utils/systemPathSource";
import {
  useActiveCloudOrgName,
  useActiveCloudOrgRepoFilter,
} from "@src/features/TeamCollaboration/useActiveCloudOrgRepoFilter";
import { BranchPalette } from "@src/scaffold/GlobalSpotlight/palettes/BranchPalette";
import { BranchDropdown } from "@src/scaffold/GlobalSpotlight/palettes/BranchPalette/BranchDropdown";
import { WorkingDirectoryPalette } from "@src/scaffold/GlobalSpotlight/palettes/WorkingDirectoryPalette";
import { WorkingDirectoryDropdown } from "@src/scaffold/GlobalSpotlight/palettes/WorkingDirectoryPalette/WorkingDirectoryDropdown";
import { modelPickerStyleAtom } from "@src/store/ui/chatPanel/displayPrefsAtoms";
import { isMultiRootWorkspaceAtom } from "@src/store/ui/workspaceFoldersAtom";
import { workspaceNameAtom } from "@src/store/workspace/derived";

import { SessionInfoRow } from "./SessionInfoLine/SessionInfoRow";
import {
  buildSessionInfoSegments,
  getSessionInfoDisplayState,
} from "./SessionInfoLine/buildSessionInfoSegments";
import type { SessionInfoLineProps } from "./SessionInfoLine/types";
import { useSelectorShortcutBridge } from "./SessionInfoLine/useSelectorShortcutBridge";
import { useSessionInfoBranchActions } from "./SessionInfoLine/useSessionInfoBranchActions";
import { useSessionInfoSelectors } from "./SessionInfoLine/useSessionInfoSelectors";
import { useSystemPathRepoItems } from "./SessionInfoLine/useSystemPathRepoItems";
import WorktreeSourceSelector from "./WorktreeSourceSelector";

export type { SessionInfoLineProps } from "./SessionInfoLine/types";

// ============================================
// Component
// ============================================

const SessionInfoLine: React.FC<SessionInfoLineProps> = ({
  strongSurface = true,
  repoId,
  repoName,
  repoPath,
  onRepoChange,
  onRepoSelect,
  repoKind,
  includeSystemPaths = false,
  branchName,
  onBranchChange,
  branchLoading,
  fullWidth: _fullWidth = false,
  dropdownDirection = "down",
  worktreeLocation,
  selectedWorktreePath,
  worktreeLocationLabel,
  worktreeSourceLabel,
  worktreeSource,
  onWorktreeLocationChange,
  onWorktreeSourceSelect,
  leadingContent,
  disabled = false,
  hideBranch = false,
}) => {
  const { t } = useTranslation();

  // ============================================
  // Selector State
  // ============================================

  const {
    isRepoSelectorOpen,
    isBranchSelectorOpen,
    setIsBranchSelectorOpen,
    isLocationDropdownOpen,
    isLocationPositioned,
    locationTriggerRef,
    locationPanelRef,
    locationPanelPosition,
    locationKeyboard,
    handleRepoTriggerClick,
    handleBranchTriggerClick,
    handleRepoSelected,
    handleBranchClose,
    handleRepoClose,
    handleLocationPanelSelect,
    openLocationSelector,
    handleLocationTriggerClick,
    openRepoSelector,
    openBranchSelector,
  } = useSessionInfoSelectors({
    disabled,
    dropdownDirection,
    onRepoChange,
    onRepoSelect,
    onWorktreeLocationChange,
    onWorktreeSourceSelect,
  });

  // ============================================
  // Anchored dropdown refs (used when modelPickerStyle === "dropdown")
  // ============================================

  const repoTriggerRef = useRef<HTMLButtonElement>(null);
  const branchTriggerRef = useRef<HTMLButtonElement>(null);
  const modelPickerStyle = useAtomValue(modelPickerStyleAtom);
  const useDropdownPicker = modelPickerStyle === "dropdown";

  const systemPathSourceItems = useSystemPathRepoItems(includeSystemPaths, t);
  const branchRepoPath = selectedWorktreePath ?? repoPath ?? "";

  // The org scope predicate no longer hides or reassigns the selection:
  // the pickers group rows into "This org" / "Outside this org" instead,
  // and out-of-scope repos are legitimate picks (they simply launch
  // without the org tag — autoTagLaunchedSessionToActiveCloudOrg guards).
  const activeCloudOrgName = useActiveCloudOrgName();
  const orgScopeRepoFilter = useActiveCloudOrgRepoFilter();

  const {
    handleBranchSelect,
    handleBranchPaletteSelect,
    handleCreateBranch,
    handleDeleteBranch,
  } = useSessionInfoBranchActions({
    repoId,
    branchRepoPath,
    repoKind,
    onBranchChange,
    setIsBranchSelectorOpen,
  });

  // ============================================
  // Display
  // ============================================

  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const workspaceName = useAtomValue(workspaceNameAtom);

  const currentRepoItem = useMemo(
    () => ({
      id: repoId ?? "",
      name: repoName ?? "",
      kind: repoKind,
    }),
    [repoId, repoName, repoKind]
  );
  const isSystemPath =
    includeSystemPaths && isSystemPathRepoItem(currentRepoItem);
  const isSystemHome =
    includeSystemPaths && isSystemHomeRepoItem(currentRepoItem);

  const { sourceDisplayName, SourceIcon, hasSource, showBranchRow } = useMemo(
    () =>
      getSessionInfoDisplayState({
        isMultiRoot,
        workspaceName,
        repoName,
        repoKind,
        isSystemPathSource: isSystemPath,
        isSystemHomeSource: isSystemHome,
        hideBranch,
        t,
      }),
    [
      isMultiRoot,
      workspaceName,
      repoName,
      repoKind,
      isSystemPath,
      isSystemHome,
      hideBranch,
      t,
    ]
  );

  useSelectorShortcutBridge({
    disabled,
    showBranchRow,
    repoId,
    worktreeLocation,
    isLocationDropdownOpen,
    openLocationSelector,
    openBranchSelector,
    openRepoSelector,
  });

  const baseSegments = buildSessionInfoSegments({
    SourceIcon,
    hasSource,
    sourceDisplayName,
    isRepoSelectorOpen,
    handleRepoTriggerClick,
    showBranchRow,
    branchLoading,
    branchName,
    isBranchSelectorOpen,
    handleBranchTriggerClick,
    worktreeLocation,
    worktreeLocationLabel,
    worktreeSourceLabel,
    isLocationDropdownOpen,
    handleLocationTriggerClick,
    locationTriggerRef,
    disabled,
    t,
  });

  // Attach refs out-of-band so the React Compiler `refs` rule doesn't
  // flag passing locally-created refs through a plain function.
  const segments = baseSegments.map((segment) => {
    if (segment.id === "repo") return { ...segment, buttonRef: repoTriggerRef };
    if (segment.id === "branch")
      return { ...segment, buttonRef: branchTriggerRef };
    return segment;
  });

  return (
    <>
      <SessionInfoRow
        segments={segments}
        strongSurface={strongSurface}
        leadingContent={leadingContent}
      />

      {/* Repo Selector */}
      {useDropdownPicker ? (
        <WorkingDirectoryDropdown
          isOpen={isRepoSelectorOpen}
          onClose={handleRepoClose}
          onSelect={handleRepoSelected}
          currentRepoId={repoId}
          anchorRef={repoTriggerRef}
          placement={dropdownDirection === "up" ? "top" : "bottom"}
          leadingRepos={systemPathSourceItems}
          repoFilter={orgScopeRepoFilter ?? undefined}
          orgScopeName={activeCloudOrgName ?? undefined}
        />
      ) : (
        <WorkingDirectoryPalette
          isOpen={isRepoSelectorOpen}
          onClose={handleRepoClose}
          onSelect={handleRepoSelected}
          currentRepoId={repoId}
          switchPathLabel={t("selectors.sessionInfo.sessionWorkspace")}
          hideActionClose
          leadingRepos={systemPathSourceItems}
          repoFilter={orgScopeRepoFilter ?? undefined}
          orgScopeName={activeCloudOrgName ?? undefined}
        />
      )}

      {/* Branch Selector */}
      {showBranchRow &&
        repoId &&
        (worktreeLocation === "worktree" && onWorktreeSourceSelect ? (
          isBranchSelectorOpen ? (
            <WorktreeSourceSelector
              key={repoId || repoPath}
              isOpen
              presentation={useDropdownPicker ? "dropdown" : "spotlight"}
              onClose={handleBranchClose}
              onSelect={onWorktreeSourceSelect}
              repoId={repoId}
              repoPath={repoPath}
              currentBranchName={branchName}
              selectedSource={worktreeSource}
              anchorRef={branchTriggerRef}
              placement={dropdownDirection === "up" ? "top" : "bottom"}
            />
          ) : null
        ) : useDropdownPicker ? (
          <BranchDropdown
            isOpen={isBranchSelectorOpen}
            onClose={handleBranchClose}
            onSelect={handleBranchSelect}
            repoId={repoId}
            repoPath={branchRepoPath}
            currentBranchName={branchName}
            groupWorktreeBranches={false}
            anchorRef={branchTriggerRef}
            placement={dropdownDirection === "up" ? "top" : "bottom"}
          />
        ) : (
          <BranchPalette
            isOpen={isBranchSelectorOpen}
            onClose={handleBranchClose}
            onSelect={handleBranchPaletteSelect}
            repoId={repoId}
            repoPath={branchRepoPath}
            currentBranchName={branchName}
            groupWorktreeBranches={false}
            onCreateBranch={handleCreateBranch}
            onDeleteBranch={handleDeleteBranch}
            variant="create-session"
            showRemoveMode
            hideActionClose
          />
        ))}

      {/* Location dropdown portal */}
      {worktreeLocation !== undefined &&
        isLocationDropdownOpen &&
        isLocationPositioned &&
        createPortal(
          <RunningLocationDropdownPanel
            panelRef={locationPanelRef}
            style={{
              position: "fixed",
              top: locationPanelPosition.top,
              bottom: locationPanelPosition.bottom,
              left: locationPanelPosition.left,
            }}
            selected={worktreeLocation}
            getItemProps={locationKeyboard.getItemProps}
            onSelect={handleLocationPanelSelect}
          />,
          document.body
        )}
    </>
  );
};

export default SessionInfoLine;

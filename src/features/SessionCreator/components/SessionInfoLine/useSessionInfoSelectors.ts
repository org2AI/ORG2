/**
 * SessionInfoLine — selector open state.
 *
 * Owns which of the three pill menus (repo, branch, running location) is
 * open, the anchored location dropdown engine, and the trigger / open /
 * close handlers that keep them mutually exclusive.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  RUNNING_LOCATIONS,
  type RunningLocation,
} from "@src/config/sessionCreatorConfig";
import { isSystemPathRepoItem } from "@src/features/SessionCreator/utils/systemPathSource";
import { useDropdownEngine } from "@src/hooks/dropdown";
import type { RepoItem } from "@src/scaffold/GlobalSpotlight/types";
import { REPO_KIND, type RepoKind } from "@src/store/repo/types";

import { type LocationRow } from "./locationConfig";
import type { SessionInfoLineProps } from "./types";

const LOCATION_ROWS: LocationRow[] = RUNNING_LOCATIONS.map((entry) => ({
  id: entry.id,
  disabled: entry.disabled === true,
}));

function getLocationRow(location: RunningLocation): LocationRow {
  return (
    LOCATION_ROWS.find((row) => row.id === location) ?? {
      id: location,
      disabled: false,
    }
  );
}

interface UseSessionInfoSelectorsOptions extends Pick<
  SessionInfoLineProps,
  | "onRepoChange"
  | "onRepoSelect"
  | "onWorktreeLocationChange"
  | "onWorktreeSourceSelect"
> {
  disabled: boolean;
  dropdownDirection: "up" | "down";
}

export function useSessionInfoSelectors({
  disabled,
  dropdownDirection,
  onRepoChange,
  onRepoSelect,
  onWorktreeLocationChange,
  onWorktreeSourceSelect,
}: UseSessionInfoSelectorsOptions) {
  const [isRepoSelectorOpen, setIsRepoSelectorOpen] = useState(false);
  const [isBranchSelectorOpen, setIsBranchSelectorOpen] = useState(false);

  // Forward declaration: the actual `close` comes back from
  // `useDropdownEngine` below, but `handleLocationRowSelect` needs to
  // close the dropdown after committing. We route through a ref to
  // avoid a circular initialization.
  const closeLocationRef = useRef<() => void>(() => undefined);

  const handleLocationRowSelect = useCallback(
    (row: LocationRow) => {
      onWorktreeLocationChange?.(row.id);
      closeLocationRef.current();
      setIsBranchSelectorOpen(false);
      if (row.id === "worktree" && onWorktreeSourceSelect) {
        queueMicrotask(() => setIsBranchSelectorOpen(true));
      }
    },
    [onWorktreeLocationChange, onWorktreeSourceSelect]
  );

  const {
    isOpen: isLocationDropdownOpen,
    isPositioned: isLocationPositioned,
    toggle: toggleLocation,
    close: closeLocation,
    triggerRef: locationTriggerRef,
    panelRef: locationPanelRef,
    panelPosition: locationPanelPosition,
    keyboard: locationKeyboard,
  } = useDropdownEngine<HTMLButtonElement, LocationRow>({
    gap: 6,
    align: "left",
    placement: dropdownDirection === "up" ? "top" : "bottom",
    listNavigation: {
      items: LOCATION_ROWS,
      onSelect: handleLocationRowSelect,
      isItemSelectable: (row) => !row.disabled,
    },
  });
  useEffect(() => {
    closeLocationRef.current = closeLocation;
  }, [closeLocation]);

  // ============================================
  // Handlers
  // ============================================

  const handleRepoTriggerClick = useCallback(() => {
    if (disabled) return;
    closeLocation();
    setIsBranchSelectorOpen(false);
    setIsRepoSelectorOpen((isOpen) => !isOpen);
  }, [closeLocation, disabled]);

  const handleBranchTriggerClick = useCallback(() => {
    if (disabled) return;
    closeLocation();
    setIsRepoSelectorOpen(false);
    setIsBranchSelectorOpen((isOpen) => !isOpen);
  }, [closeLocation, disabled]);

  const handleRepoSelected = useCallback(
    (selectedRepoId: string, repo: RepoItem) => {
      if (isSystemPathRepoItem(repo)) {
        onRepoSelect?.(selectedRepoId, repo);
        setIsRepoSelectorOpen(false);
        return;
      }

      const kind = (repo.kind as RepoKind) ?? REPO_KIND.GIT;
      onRepoSelect?.(selectedRepoId, repo);
      onRepoChange?.(selectedRepoId, { repoKind: kind });
      setIsRepoSelectorOpen(false);
    },
    [onRepoSelect, onRepoChange]
  );

  const handleBranchClose = useCallback(() => {
    setIsBranchSelectorOpen(false);
  }, []);

  const handleRepoClose = useCallback(() => {
    setIsRepoSelectorOpen(false);
  }, []);

  const handleLocationPanelSelect = useCallback(
    (location: RunningLocation) => {
      handleLocationRowSelect(getLocationRow(location));
    },
    [handleLocationRowSelect]
  );

  const openLocationSelector = useCallback(() => {
    setIsRepoSelectorOpen(false);
    setIsBranchSelectorOpen(false);
    toggleLocation();
  }, [toggleLocation]);

  const handleLocationTriggerClick = useCallback(() => {
    if (disabled) return;
    openLocationSelector();
  }, [disabled, openLocationSelector]);

  const openRepoSelector = useCallback(() => {
    closeLocation();
    setIsBranchSelectorOpen(false);
    setIsRepoSelectorOpen(true);
  }, [closeLocation]);

  const openBranchSelector = useCallback(() => {
    closeLocation();
    setIsRepoSelectorOpen(false);
    setIsBranchSelectorOpen(true);
  }, [closeLocation]);

  return {
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
  };
}

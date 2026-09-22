import type React from "react";

import type { RunningLocation } from "@src/config/sessionCreatorConfig";
import type { RepoItem } from "@src/scaffold/GlobalSpotlight/types";
import type { RepoKind } from "@src/store/repo/types";
import type {
  WorktreeLaunchSelection,
  WorktreeLaunchSource,
} from "@src/store/session/worktreeLaunchSourceAtom";

export interface SessionInfoLineProps {
  /** Use the original stronger hover/open surface unless explicitly disabled. */
  strongSurface?: boolean;
  /** Current repository ID */
  repoId?: string;
  /** Current repository name */
  repoName?: string;
  /** Current repository path (fs_uri) - needed for branch fetching */
  repoPath?: string;
  /**
   * Switch-workspace handler. Selecting a repo updates the Human Station
   * workspace atom AND the session source. Optional when `disabled` is
   * true (read-only mode used by post-launch surfaces).
   */
  onRepoChange?: (repoId: string, options?: { repoKind?: RepoKind }) => void;
  /**
   * Session-only handler. When provided, selecting a repo calls this
   * (updates session source only). After branch is picked, a follow-up
   * selector asks whether to switch the workspace too.
   * If absent, onRepoChange is used directly.
   */
  onRepoSelect?: (repoId: string, repo: RepoItem) => void;
  /** Local/Git source kind — `folder` hides branch UI */
  repoKind?: RepoKind;
  /** Whether to include system path sources in the source selector. */
  includeSystemPaths?: boolean;
  /** Current branch name */
  branchName?: string;
  /** Handler for branch change. Optional when `disabled` is true. */
  onBranchChange?: (branch: string) => void;
  /** Whether branches are loading */
  branchLoading?: boolean;
  /**
   * Read-only mode: pills render with disabled styling and clicks are
   * suppressed (no selectors open). Used by post-launch surfaces where
   * repo / branch / location are immutable.
   */
  disabled?: boolean;
  /**
   * Suppress the branch segment regardless of `repoKind`. Used in
   * read-only post-launch contexts where branch is locked and not
   * interesting to display.
   */
  hideBranch?: boolean;
  /**
   * When true, the row sits in a full-width SessionCreator surface (e.g. the
   * fullScreen ChatPanel creator) immediately under the composer input.
   */
  fullWidth?: boolean;
  /** Direction used by anchored repo, branch, and location menus. */
  dropdownDirection?: "up" | "down";
  /**
   * When provided, adds a third segment for selecting the running location
   * (This Mac / New Worktree / Cloud) — modelled after Cursor's context bar.
   */
  worktreeLocation?: RunningLocation;
  selectedWorktreePath?: string | null;
  worktreeLocationLabel?: string;
  worktreeSourceLabel?: string;
  worktreeSource?: WorktreeLaunchSource | null;
  onWorktreeLocationChange?: (location: RunningLocation) => void;
  onWorktreeSourceSelect?: (selection: WorktreeLaunchSelection) => void;
  /** Optional control rendered before the repository, location, and branch pills. */
  leadingContent?: React.ReactNode;
}

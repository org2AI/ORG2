import type React from "react";

import type { AddWorkingDirectoryModalStage } from "../../hooks";
import type { BasePaletteProps } from "../../shared";
import type { RepoItem } from "../../types";

export type AddMenuKind = "add" | null;

export const WORKING_DIRECTORY_PALETTE_SECTION_KEY = {
  CURRENT: "current",
  RECENT: "recent",
  SYSTEM_PATH: "systemPath",
  EXTERNAL_RECENT: "externalRecent",
  REPO: "repo",
  WORKING_DIRECTORY: "workingDirectory",
  MULTI_REPO_WORKSPACE: "multiRepoWorkspace",
  THIS_ORG: "thisOrg",
  OUTSIDE_ORG: "outsideOrg",
} as const;

export type WorkingDirectoryPaletteSectionKey =
  (typeof WORKING_DIRECTORY_PALETTE_SECTION_KEY)[keyof typeof WORKING_DIRECTORY_PALETTE_SECTION_KEY];

export interface WorkingDirectoryPaletteProps extends BasePaletteProps {
  onSelect: (repoId: string, repo: RepoItem) => void;
  currentRepoId?: string;
  initialAddStage?: AddWorkingDirectoryModalStage;
  initialAddMenu?: boolean;
  initialManageMode?: boolean;
  topSlot?: React.ReactNode;
  asBody?: boolean;
  switchPathLabel?: string;
  hideActionClose?: boolean;
  leadingRepos?: readonly RepoItem[];
  /**
   * Org-scope membership predicate (e.g. active cloud org repo scope).
   * Rows are never hidden by it: matching rows group under "This org",
   * the rest under "Outside this org".
   */
  repoFilter?: (repo: {
    repo_url?: string | null;
    fs_uri?: string | null;
  }) => boolean;
  /** Display name for the organization represented by `repoFilter`. */
  orgScopeName?: string;
}

export interface WorkingDirectoryPaletteText {
  switchPathLabel: string;
  switchPathTemplate: string;
  switchPlaceholder: string;
  invalidPathTitle: string;
  invalidPathMessage: (path: string) => string;
  addPathLabel: string;
  addPathTemplate: string;
  addPlaceholder: string;
  addEntryLabel: string;
  openFolderLabel: string;
  addFolderLabel: string;
  sectionCurrentLabel: string;
  sectionRecentLabel: string;
  sectionSystemPathsLabel: string;
  sectionExternalRecentLabel: string;
  sectionRepoLabel: string;
  sectionWorkingDirectoryLabel: string;
  sectionMultiRepoWorkingDirectoryLabel: string;
  sectionThisOrgLabel: string;
  sectionOutsideOrgLabel: string;
}

import type { WorkspaceSwitchEntry } from "../../hooks";
import type { RepoItem, SpotlightItem } from "../../types";

export type DropdownRepoItem =
  | { kind: "repo"; repo: RepoItem }
  | { kind: "workspace"; entry: WorkspaceSwitchEntry }
  | { kind: "openPath"; item: SpotlightItem };
export type DropdownRepoRowItem = Extract<DropdownRepoItem, { kind: "repo" }>;
export type DropdownWorkspaceRowItem = Extract<
  DropdownRepoItem,
  { kind: "workspace" }
>;

export type WorkingDirectoryDropdownSectionKey =
  | "openPath"
  | "recent"
  | "multiRepoWorkspace"
  | "system"
  | "externalRecent"
  | "workspace"
  | "repo"
  | "thisOrg"
  | "outsideOrg";

export interface WorkingDirectoryDropdownSection {
  key: WorkingDirectoryDropdownSectionKey;
  label: string | null;
  items: DropdownRepoItem[];
}

/**
 * Workspace Store
 *
 * Multi-root workspace atoms: core folder list, active folder resolution,
 * and display helpers. The folder-list atom itself lives in
 * `src/store/ui/workspaceFoldersAtom.ts` (legacy location) and is re-exported
 * here so consumers can import everything from `@src/store/workspace`.
 */

export {
  workspaceFoldersAtom,
  activeFolderIdAtom,
  activeWorkspaceIdAtom,
  workspaceActiveAtom,
} from "../ui/workspaceFoldersAtom";

export {
  activeWorkspaceRootAtom,
  activeWorkspaceRootNameAtom,
  activeWorkspaceRootPathAtom,
  primaryWorkspaceRootAtom,
  primaryWorkspaceRootPathAtom,
  activeWorktreeAtom,
  setActiveWorktreeAtom,
  type ActiveWorktreeSelection,
} from "./derived";

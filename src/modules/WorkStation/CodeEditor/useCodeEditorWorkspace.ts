import { useAtomValue } from "jotai";

import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useEditorRepoCacheSync } from "@src/hooks/ui/tabs/useEditorRepoCacheSync";
import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";

import { useCodeEditor } from "./hooks/useCodeEditor";

/**
 * The selected repo, the workspace folders and the file tree / content state
 * for the repo the Code Editor is browsing.
 */
export function useCodeEditorWorkspace(repoPath: string) {
  // === Repo selection (needed early for repo ID) ===
  const { currentBranch, selectedRepoId } = useRepoSelection({
    autoLoad: true,
  });

  // === Editor tab cache sync (saves file tabs per repo) ===
  useEditorRepoCacheSync();

  // === Workspace folders for multi-root support ===
  const workspaceFolders = useAtomValue(workspaceFoldersAtom);

  // === Business logic hooks ===
  const codeEditorState = useCodeEditor({
    repoPath,
    repoId: selectedRepoId || repoPath,
    autoLoad: true,
    workspaceFolders:
      workspaceFolders.length > 1 ? workspaceFolders : undefined,
  });

  return { currentBranch, selectedRepoId, workspaceFolders, codeEditorState };
}

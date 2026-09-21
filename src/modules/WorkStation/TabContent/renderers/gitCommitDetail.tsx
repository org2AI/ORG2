/**
 * Renderer wrapper for `git-commit-detail` AND `git-stash-detail` tabs.
 *
 * Renders `GitCommitDetailContent` through the unified dispatcher, pulling
 * repoPath / repoId / file-select from the hoisted Code Editor host context
 * and the commit metadata from tab data — a 1:1 mirror of
 * `TabContentRenderer`'s `case "git-commit-detail"`.
 *
 * WHY ONE RENDERER FOR TWO TAB TYPES: a stash detail really is a commit detail.
 * `GitCommitDetailContent` is stash-agnostic — it loads a diff by `commitSha`
 * and nothing else. The stash/commit divergence is resolved one layer up, in
 * `createStashDetailTab` (store/workstation/tabs/factories/codeEditor.ts), which
 * normalizes `stashIdentity` (the stash's commit sha, or `stash@{n}` when it has
 * none) into `commitSha` and derives `shortSha` / `commitMessage` from the stash
 * ref. The stash-only fields it also carries — `stashIndex`, `stashRef`,
 * `stashIdentity`, `stashCommitSha` — feed the tab's id, title and icon, not
 * this renderer. So there is nothing left here for a separate wrapper to do.
 * If stash detail ever needs its own presentation, give this renderer a
 * parameter (e.g. an `isStash` flag off the tab type); do not re-fork the file.
 */
import { useEditorHostContext } from "@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/context/editorHostContext";

import { createLazyTabRenderer } from "./createLazyTabRenderer";

const GitCommitDetailTabRenderer = createLazyTabRenderer({
  displayName: "GitCommitDetailTabRenderer",
  load: () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/GitCommitDetailContent"),
  useProps: ({ tab }) => {
    const { repoPath, repoId, onFileSelect } = useEditorHostContext();
    const resolvedRepoId = repoId ?? repoPath;

    return {
      commitSha: String(tab.data.commitSha || ""),
      shortSha: String(tab.data.shortSha || ""),
      commitMessage: String(tab.data.commitMessage || ""),
      repoPath,
      repoId: resolvedRepoId,
      isRepoReady: Boolean(repoPath && resolvedRepoId),
      onFileSelect,
    };
  },
});

export default GitCommitDetailTabRenderer;

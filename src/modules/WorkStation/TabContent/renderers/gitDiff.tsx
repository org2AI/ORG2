/**
 * Renderer wrapper for `git-diff` tabs (also handles the timeline diff
 * variant where `tab.data.isTimeline === true`).
 *
 * Renders the historical / snapshot single-file diff through the unified
 * dispatcher, resolving the `GitFile` from the hoisted Code Editor host
 * context's `gitFilesByPath` map — a 1:1 mirror of `TabContentRenderer`'s
 * `case "git-diff"` (which keys the map by `tab.id` for timeline diffs and by
 * `tab.data.filePath` otherwise).
 */
import { useMemo } from "react";

import { useEditorHostContext } from "@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/context/editorHostContext";

import { createLazyTabRenderer } from "./createLazyTabRenderer";

const GitDiffTabRenderer = createLazyTabRenderer({
  displayName: "GitDiffTabRenderer",
  load: () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/GitDiffContent"),
  useProps: ({ tab }) => {
    const {
      gitFilesByPath,
      gitDiffLoading,
      repoPath,
      forceRefresh,
      onFileSelect,
      onGitDiffUnsavedChange,
    } = useEditorHostContext();

    const gitFile = useMemo(() => {
      const gitFileKey = tab.data.isTimeline
        ? tab.id
        : (tab.data.filePath as string);
      return gitFilesByPath.get(gitFileKey) || null;
    }, [tab, gitFilesByPath]);

    return {
      gitFile,
      loading: gitDiffLoading,
      repoPath,
      onReload: forceRefresh,
      onFileSelect,
      onUnsavedChange: onGitDiffUnsavedChange,
    };
  },
});

export default GitDiffTabRenderer;

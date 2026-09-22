/**
 * Renderer wrapper for `directory` tabs.
 *
 * Mirrors `TabContentRenderer`'s `case "directory"`: renders
 * `DirectoryExplorerContent`, pulling `repoPath` + `onFileSelect` from the
 * hoisted Code Editor host context (`useEditorHostContext`) and `directoryPath`
 * from `tab.data`.
 *
 * `directory` is editor-only — tabs are created only from
 * `CodeEditor/hooks/useCodeEditorEvents.ts` and recursively from
 * `DirectoryExplorerContent` itself — so coupling this renderer to the editor
 * host is safe: it throws if mounted outside an `EditorHostProvider`.
 */
import { useEditorHostContext } from "@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/context/editorHostContext";

import { createLazyTabRenderer } from "./createLazyTabRenderer";

const DirectoryTabRenderer = createLazyTabRenderer({
  displayName: "DirectoryTabRenderer",
  load: () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/DirectoryExplorerContent"),
  useProps: ({ tab }) => {
    const { repoPath, onFileSelect } = useEditorHostContext();
    const directoryPath = String(tab.data.directoryPath ?? "");

    return { directoryPath, repoPath, onFileSelect };
  },
  // Remount when the repo or directory changes, as before.
  getKey: (_tabProps, { repoPath, directoryPath }) =>
    `${repoPath}:${directoryPath}`,
});

export default DirectoryTabRenderer;

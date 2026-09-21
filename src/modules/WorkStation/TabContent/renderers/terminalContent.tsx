/**
 * Renderer wrapper for `terminal-content` tabs (read-only terminal
 * output viewer opened from a pill double-click).
 *
 * Pipes `tab.data.content` through a read-only `CodeViewerContent` — a 1:1
 * mirror of `TabContentRenderer`'s `case "terminal-content"`. Self-contained:
 * it derives everything from `tab.data` and needs no host context (the viewer
 * takes `repoPath=""`).
 */
import { createLazyTabRenderer } from "./createLazyTabRenderer";

const TerminalContentTabRenderer = createLazyTabRenderer({
  displayName: "TerminalContentTabRenderer",
  load: () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/CodeViewerContent"),
  useProps: ({ tab }) => ({
    selectedFile: String(
      tab.data.terminalName || tab.title || "Terminal Output"
    ),
    fileContent: String(tab.data.content || ""),
    loading: false,
    error: null,
    repoPath: "",
    readOnly: true,
  }),
});

export default TerminalContentTabRenderer;

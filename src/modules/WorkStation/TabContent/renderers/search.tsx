/**
 * Renderer wrapper for `search` tabs.
 *
 * Renders `SearchEditorContent` through the unified dispatcher, pulling
 * repoPath + the result-click callbacks from the hoisted Code
 * Editor host context and the query/options from tab data — a 1:1 mirror of
 * `TabContentRenderer`'s `case "search"` (including its `handleSearchResultClick`
 * line-aware navigation).
 */
import { useCallback } from "react";

import { useEditorHostContext } from "@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/context/editorHostContext";
import type { SearchOptions as StoreSearchOptions } from "@src/store/workstation/codeEditor/search";

import { createLazyTabRenderer } from "./createLazyTabRenderer";

const SearchTabRenderer = createLazyTabRenderer({
  displayName: "SearchTabRenderer",
  load: () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/SearchEditorContent"),
  useProps: ({ tab }) => {
    const { repoPath, onFileSelect, onFileSelectWithLine } =
      useEditorHostContext();

    const handleSearchResultClick = useCallback(
      (filePath: string, line: number, _column?: number) => {
        if (line > 0 && onFileSelectWithLine) {
          onFileSelectWithLine(filePath, line);
        } else {
          onFileSelect(filePath);
        }
      },
      [onFileSelect, onFileSelectWithLine]
    );

    return {
      sessionScopeId: tab.id,
      repoPath,
      initialQuery: String(tab.data.initialQuery || ""),
      initialOptions: tab.data.initialOptions as StoreSearchOptions,
      onResultClick: handleSearchResultClick,
    };
  },
  // One search surface per tab; remount if the tab identity changes.
  getKey: ({ tab }) => tab.id,
});

export default SearchTabRenderer;

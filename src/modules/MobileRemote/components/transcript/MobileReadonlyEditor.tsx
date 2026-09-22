import { StreamLanguage } from "@codemirror/language";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorView, lineNumbers } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import React, { memo, useMemo } from "react";

import { codeMirrorCspNonceExtension } from "@src/features/CodeMirror/config/csp";
import {
  CODEMIRROR_BASE_LAYOUT_THEME,
  getCodeMirrorTheme,
} from "@src/features/CodeMirror/config/themeConfig";
import { getLanguageExtension } from "@src/features/CodeMirror/shared/languageExtensions";
import { MERGE_THEME_OVERRIDE } from "@src/features/CodeMirror/shared/mergeTheme";

const setup = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  autocompletion: false,
  history: false,
  searchKeymap: false,
};
const diffLanguage = StreamLanguage.define(diff);

/** Workstation's engine/theme/languages without Desktop services or writes. */
export default memo(function MobileReadonlyEditor({
  content,
  original,
  filePath,
  language,
  startLine = 1,
  wrap,
  height = "100%",
}: {
  content: string;
  original?: string;
  filePath: string;
  language?: string;
  startLine?: number;
  wrap: boolean;
  height?: "100%" | "auto";
}) {
  const highlight = content.length <= 100_000;
  // Keep the diff extension stable when only wrapping or editor layout changes.
  const merge = useMemo(
    () =>
      original === undefined
        ? []
        : [
            MERGE_THEME_OVERRIDE,
            unifiedMergeView({
              original,
              mergeControls: false,
              highlightChanges: true,
              syntaxHighlightDeletions: true,
              syntaxHighlightDeletionsMaxLength: 20_000,
              diffConfig: { scanLimit: 500, timeout: 50 },
            }),
          ],
    [original]
  );
  const extensions = useMemo(() => {
    const syntax = highlight
      ? language === "diff"
        ? diffLanguage
        : getLanguageExtension(filePath, language)
      : null;
    return [
      codeMirrorCspNonceExtension,
      CODEMIRROR_BASE_LAYOUT_THEME,
      lineNumbers({ formatNumber: (line) => String(line + startLine - 1) }),
      EditorView.contentAttributes.of({
        "aria-label": filePath,
        tabindex: "0",
      }),
      ...(syntax ? [syntax] : []),
      ...merge,
      ...(wrap ? [EditorView.lineWrapping] : []),
    ];
  }, [highlight, filePath, language, startLine, wrap, merge]);
  return (
    <CodeMirror
      // The library initializes the original document once. A new snapshot
      // gets a fresh editor; wrapping keeps the same editor and scroll state.
      key={original}
      value={content}
      readOnly
      editable={false}
      autoFocus={false}
      height={height}
      theme={getCodeMirrorTheme()}
      basicSetup={setup}
      extensions={extensions}
      className="mobile-readonly-editor h-full min-h-0"
    />
  );
});

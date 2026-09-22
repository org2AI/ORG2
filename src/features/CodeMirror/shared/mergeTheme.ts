import { EditorView } from "@codemirror/view";

// ============================================
// Shared merge theme override (stable reference — defined outside component)
// ============================================

export const MERGE_THEME_OVERRIDE = EditorView.baseTheme({
  "& .cm-changedLine, & .cm-insertedLine": {
    backgroundColor: "var(--diff-added-bg) !important",
  },
  "&.cm-merge-a .cm-changedLine, & .cm-deletedLine": {
    backgroundColor: "var(--diff-deleted-bg) !important",
  },
  "& .cm-insertedChunk, & .cm-insertedText": {
    backgroundColor: "var(--diff-added-bg) !important",
  },
  "& .cm-deletedChunk, & .cm-deletedText": {
    backgroundColor: "var(--diff-deleted-bg) !important",
  },
  ".cm-collapsedLines": {
    display: "flex",
    alignItems: "center",
    gap: "var(--cm-gutter-padding, 4px)",
    width: "100%",
    background: "var(--color-fill-1)",
    border: "none",
    borderRadius: "0",
    outline: "none",
    boxShadow: "none",
    color: "var(--color-text-3)",
    padding: "var(--cm-gutter-padding, 4px) var(--cm-line-padding-left, 12px)",
    margin: "0",
    cursor: "var(--interactive-cursor, default)",
    fontSize: "var(--cm-font-size-small, 12px)",
    "&::before": {
      content: '""',
      display: "inline-block",
      width: "var(--cm-icon-size, 14px)",
      height: "var(--cm-icon-size, 14px)",
      marginInlineEnd: "0",
      backgroundColor: "currentColor",
      maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E")`,
      maskSize: "contain",
      maskRepeat: "no-repeat",
      maskPosition: "center",
      WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E")`,
      WebkitMaskSize: "contain",
      WebkitMaskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
      flexShrink: 0,
    },
    "&::after": {
      content: '""',
      display: "none",
    },
    "&:hover": {
      background: "var(--color-fill-3)",
      color: "var(--color-text-2)",
    },
  },
});

/**
 * useEditorDisplayToggles Hook
 *
 * One wiring for the editor display toggles shown in file-header "…" menus
 * (line numbers, word wrap, minimap, active-line highlight, git blame and the
 * split-diff centered line-number layout). Every header reads and writes the
 * shared `editor.*` settings through this hook so the menus cannot drift.
 *
 * `editor.lineNumbers` is a mode ("on" | "off" | "relative" | "interval"),
 * not a boolean. The menu checkbox is `mode !== "off"`; unchecking it writes
 * "off" and remembers the previous visible mode for this app session, and
 * checking it restores that mode (falling back to "on"). A relative or
 * interval mode is never rewritten to "on".
 */
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";

import {
  type EditorLineNumbers,
  editorHighlightActiveLineAtom,
  editorLineNumbersAtom,
  editorShowBlameAtom,
  editorShowMinimapAtom,
  editorSplitDiffCenteredLineNumbersAtom,
  editorWordWrapAtom,
} from "@src/store/ui/editorSettingsAtom";

type VisibleLineNumbers = Exclude<EditorLineNumbers, "off">;

/** Session-only memory of the mode that was active before the header hid line numbers. */
const lastVisibleLineNumbersAtom = atom<VisibleLineNumbers | null>(null);

/**
 * Resolve the line-number mode a header toggle should write.
 * Returns `null` when the toggle would not change the stored mode.
 */
export function resolveLineNumbersToggle(
  current: EditorLineNumbers,
  enabled: boolean,
  remembered: VisibleLineNumbers | null
): { next: EditorLineNumbers; remember: VisibleLineNumbers | null } | null {
  if (!enabled) {
    if (current === "off") return null;
    return { next: "off", remember: current };
  }
  if (current !== "off") return null;
  return { next: remembered ?? "on", remember: remembered };
}

/** Write-only atom behind the header "Line numbers" checkbox. */
export const toggleEditorLineNumbersAtom = atom(
  null,
  (get, set, enabled: boolean) => {
    const resolved = resolveLineNumbersToggle(
      get(editorLineNumbersAtom),
      enabled,
      get(lastVisibleLineNumbersAtom)
    );
    if (!resolved) return;
    set(lastVisibleLineNumbersAtom, resolved.remember);
    set(editorLineNumbersAtom, resolved.next);
  }
);

export interface EditorDisplayToggles {
  lineNumbersEnabled: boolean;
  onLineNumbersChange: (enabled: boolean) => void;
  wordWrapEnabled: boolean;
  onWordWrapChange: (enabled: boolean) => void;
  minimapEnabled: boolean;
  onMinimapChange: (enabled: boolean) => void;
  highlightActiveLineEnabled: boolean;
  onHighlightActiveLineChange: (enabled: boolean) => void;
  gitBlameEnabled: boolean;
  onGitBlameChange: (enabled: boolean) => void;
  splitCenteredLineNumbersEnabled: boolean;
  onSplitCenteredLineNumbersChange: (enabled: boolean) => void;
}

/** Values and setters for the shared editor display toggles, named after the FileHeader props. */
export function useEditorDisplayToggles(): EditorDisplayToggles {
  const lineNumbers = useAtomValue(editorLineNumbersAtom);
  const toggleLineNumbers = useSetAtom(toggleEditorLineNumbersAtom);
  const [wordWrap, setWordWrap] = useAtom(editorWordWrapAtom);
  const [minimap, setMinimap] = useAtom(editorShowMinimapAtom);
  const [highlightActiveLine, setHighlightActiveLine] = useAtom(
    editorHighlightActiveLineAtom
  );
  const [gitBlame, setGitBlame] = useAtom(editorShowBlameAtom);
  const [splitCenteredLineNumbers, setSplitCenteredLineNumbers] = useAtom(
    editorSplitDiffCenteredLineNumbersAtom
  );

  return {
    lineNumbersEnabled: lineNumbers !== "off",
    onLineNumbersChange: toggleLineNumbers,
    wordWrapEnabled: wordWrap,
    onWordWrapChange: setWordWrap,
    minimapEnabled: minimap,
    onMinimapChange: setMinimap,
    highlightActiveLineEnabled: highlightActiveLine,
    onHighlightActiveLineChange: setHighlightActiveLine,
    gitBlameEnabled: gitBlame,
    onGitBlameChange: setGitBlame,
    splitCenteredLineNumbersEnabled: splitCenteredLineNumbers,
    onSplitCenteredLineNumbersChange: setSplitCenteredLineNumbers,
  };
}

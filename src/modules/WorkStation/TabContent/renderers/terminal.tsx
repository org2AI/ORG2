/**
 * Renderer wrapper for the pinned `terminal` tab.
 *
 * Renders `TerminalMainContent` with the LIVE PTY runtime (`terminalState`)
 * from the hoisted Code Editor host context — a 1:1 mirror of
 * `TabContentRenderer`'s `case "terminal"`.
 *
 * IMPORTANT: `terminalState` MUST be the same instance the host holds; a fresh
 * runtime would detach from any running session. Note that in the live editor
 * host today the terminal is actually painted by a dedicated keep-alive overlay
 * in `EditorMainPane` (mounted while a terminal tab is active) — the switch's
 * `case "terminal"` is effectively unreachable there because `TabContentRenderer`
 * is not mounted while the terminal tab is active. This renderer preserves the
 * exact switch behaviour so the spec stays faithful for any host that routes the
 * `terminal` type through the dispatcher.
 */
import { useEditorHostContext } from "@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/context/editorHostContext";

import { createLazyTabRenderer } from "./createLazyTabRenderer";

const TerminalTabRenderer = createLazyTabRenderer({
  displayName: "TerminalTabRenderer",
  load: () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/TerminalMainContent"),
  useProps: () => {
    const { terminalState, repoPath } = useEditorHostContext();
    return { terminalState, repoPath };
  },
});

export default TerminalTabRenderer;

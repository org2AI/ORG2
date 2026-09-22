/**
 * StatusBar Components
 *
 * Unified status bar components for Workstation apps. Consumers import the
 * variants (StatusBarBase, EditorStatusBar, ProjectStatusBar,
 * StatusBarRenderer, …) from their own files; this barrel only carries the
 * pieces still imported through it.
 */

export type { CommitInfo, CursorPosition } from "./EditorStatusBar";

export { default as BrowserStatusBar } from "./BrowserStatusBar";

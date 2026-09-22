import { atom } from "jotai";

/** The mounted sidebar refreshes its selected repo/worktree, including stashes.
 * Returning undefined means no pane is mounted; the header uses shared status.
 */
export type SourceControlRefreshHandler = () => Promise<void> | undefined;
export const sourceControlRefreshHandlerAtom =
  atom<SourceControlRefreshHandler | null>(null);
sourceControlRefreshHandlerAtom.debugLabel = "sourceControlRefreshHandlerAtom";

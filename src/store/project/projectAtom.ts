import { atom } from "jotai";

/**
 * Signal atom to trigger project list refresh.
 * Bump this value after creating/deleting a project so the sidebar re-fetches.
 */
export const projectListRefreshAtom = atom(0);
projectListRefreshAtom.debugLabel = "projectListRefreshAtom";

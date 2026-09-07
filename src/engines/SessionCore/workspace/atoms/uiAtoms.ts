/**
 * Workspace UI state consumed by chat history.
 */
import { atom } from "jotai";

/** Is exploring */
export const isExploringAtom = atom<boolean>(false);
isExploringAtom.debugLabel = "workspace/isExploring";

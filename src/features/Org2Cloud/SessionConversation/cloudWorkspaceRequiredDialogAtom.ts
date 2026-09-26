import { atom } from "jotai";

/** One dialog per app store, opened only by an attempted Agent continuation. */
export const cloudWorkspaceRequiredDialogAtom = atom(false);
cloudWorkspaceRequiredDialogAtom.debugLabel =
  "cloudWorkspaceRequiredDialogAtom";

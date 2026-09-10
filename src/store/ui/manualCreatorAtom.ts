import { atom } from "jotai";

import type { ChatPanelCreateProjectContext } from "./chatPanel/selectionAtoms";

export interface ManualCreatorRequest {
  target: "project" | "workItem";
  createProjectContext?: ChatPanelCreateProjectContext | null;
}

/** A single Spotlight manual creator, disposed when dismissed. */
export const manualCreatorAtom = atom<ManualCreatorRequest | null>(null);

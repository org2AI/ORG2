import { atom } from "jotai";

import type { ForkExecutionSelection } from "./engine/collabSyncEngineHelpers";

export interface ForkSessionSetupSelection {
  workspaceRepoPath: string | null;
  execution: ForkExecutionSelection;
}

export interface ForkSessionSetupRequest {
  sourceTitle: string;
  sourceScopeKey?: string;
  sourceModel?: string;
  sourceAgentDisplayName?: string;
  sourceAgentDefinitionId?: string;
  resolve: (selection: ForkSessionSetupSelection | null) => void;
}

export const forkSessionSetupRequestAtom = atom<ForkSessionSetupRequest | null>(
  null
);
forkSessionSetupRequestAtom.debugLabel = "forkSessionSetupRequestAtom";

export interface ForkCheckoutRequest {
  /** Normalized scope key of the SOURCE repo the fork must land in. */
  sourceScopeKey: string;
  /** Source session title (dialog context line). */
  sourceTitle: string;
  /** Resolves with the picked local path, or null on cancel. */
  resolve: (localPath: string | null) => void;
}

/** One-shot handoff: fork flow parks a request; the dialog consumes it. */
export const forkCheckoutRequestAtom = atom<ForkCheckoutRequest | null>(null);
forkCheckoutRequestAtom.debugLabel = "forkCheckoutRequestAtom";

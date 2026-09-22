import { atom } from "jotai";

import type {
  AdeManagerRunStatus,
  PendingSessionProposal,
} from "@src/contracts/session";

export interface AdeManagerPaletteState {
  sessionId: string | null;
  draftText: string;
  runStatus: AdeManagerRunStatus;
  activityCursor: number;
  pendingProposal: PendingSessionProposal | null;
}

const INITIAL_STATE: AdeManagerPaletteState = {
  sessionId: null,
  draftText: "",
  runStatus: "idle",
  activityCursor: 0,
  pendingProposal: null,
};

export const adeManagerPaletteAtom =
  atom<AdeManagerPaletteState>(INITIAL_STATE);

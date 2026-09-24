import { atom } from "jotai";

/** One pending view navigation, consumed by the target session's existing chat navigator. */
export const agentOrgExecutionNavigationAtom = atom<{
  sessionId: string;
  turnIntentId: string;
} | null>(null);

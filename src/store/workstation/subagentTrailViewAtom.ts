import { atom } from "jotai";

export interface SubagentTrailView {
  scope: string;
  selected: string | null;
  scrollTop: number;
  visibleCount: number;
}

export const EMPTY_SUBAGENT_TRAIL_VIEW: SubagentTrailView = {
  scope: "",
  selected: null,
  scrollTop: 0,
  visibleCount: 20,
};
// Only the last inspected parent is retained. No unbounded per-session map.
export const subagentTrailViewAtom = atom(EMPTY_SUBAGENT_TRAIL_VIEW);

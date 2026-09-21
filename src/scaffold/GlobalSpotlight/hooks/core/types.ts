import type { ActionDefinition, PathSegment, SpotlightItem } from "../../types";

/** State for the root command list and its parameter picker. */
export interface SpotlightState {
  path: PathSegment[];
  searchQuery: string;
  currentAction: ActionDefinition | null;
  missingParam: ActionDefinition["requiredParams"][0] | null;
}

export type SpotlightAction =
  | { type: "PUSH_ACTION"; payload: { action: ActionDefinition } }
  | { type: "POP_SEGMENT" }
  | { type: "TRUNCATE_PATH"; payload: { index: number } }
  | { type: "SET_SEARCH_QUERY"; payload: { query: string } }
  | { type: "RESET" };

export interface UseSpotlightItemsReturn {
  items: SpotlightItem[];
}

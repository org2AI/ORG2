import type { SpotlightAction, SpotlightState } from "./types";

export const initialSpotlightState: SpotlightState = {
  path: [],
  searchQuery: "",
  currentAction: null,
  missingParam: null,
};

export function spotlightReducer(
  state: SpotlightState,
  action: SpotlightAction
): SpotlightState {
  switch (action.type) {
    case "PUSH_ACTION": {
      const selected = action.payload.action;
      return {
        path: [
          {
            type: "action",
            id: selected.id,
            label: selected.label,
            icon: selected.icon,
            color: selected.color,
            data: selected,
          },
        ],
        searchQuery: "",
        currentAction: selected,
        missingParam: selected.requiredParams[0] ?? null,
      };
    }
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.payload.query };
    case "TRUNCATE_PATH":
      return action.payload.index > 0 ? state : initialSpotlightState;
    case "POP_SEGMENT":
    case "RESET":
      return initialSpotlightState;
    default:
      action satisfies never;
      return state;
  }
}

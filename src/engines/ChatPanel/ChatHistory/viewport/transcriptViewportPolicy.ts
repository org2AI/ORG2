export type TranscriptFollowMode = "following_tail" | "detached_reading";

export interface TranscriptViewportPolicyState {
  mode: TranscriptFollowMode;
}

export type TranscriptViewportPolicyEvent =
  | { type: "session_opened" }
  | { type: "user_scroll"; atTail: boolean }
  | { type: "explicit_follow" }
  | { type: "explicit_navigation" }
  | { type: "explicit_layout_change" };

export const INITIAL_TRANSCRIPT_VIEWPORT_POLICY_STATE: TranscriptViewportPolicyState =
  { mode: "following_tail" };

/**
 * Geometry changes never decide reader intent. Only real user input and
 * explicit navigation/follow actions may move the policy between states.
 */
export function reduceTranscriptViewportPolicy(
  state: TranscriptViewportPolicyState,
  event: TranscriptViewportPolicyEvent
): TranscriptViewportPolicyState {
  switch (event.type) {
    case "session_opened":
      return state.mode === "following_tail"
        ? state
        : { mode: "following_tail" };
    case "user_scroll": {
      const mode = event.atTail ? "following_tail" : "detached_reading";
      return state.mode === mode ? state : { mode };
    }
    case "explicit_follow":
      return state.mode === "following_tail"
        ? state
        : { mode: "following_tail" };
    case "explicit_navigation":
    case "explicit_layout_change":
      return state.mode === "detached_reading"
        ? state
        : { mode: "detached_reading" };
  }
}

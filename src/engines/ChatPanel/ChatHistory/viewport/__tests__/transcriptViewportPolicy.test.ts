import { describe, expect, it } from "vitest";

import {
  INITIAL_TRANSCRIPT_VIEWPORT_POLICY_STATE,
  reduceTranscriptViewportPolicy,
} from "../transcriptViewportPolicy";

describe("transcript viewport policy", () => {
  it("changes reader intent only for real input or explicit actions", () => {
    const detached = reduceTranscriptViewportPolicy(
      INITIAL_TRANSCRIPT_VIEWPORT_POLICY_STATE,
      { type: "user_scroll", atTail: false }
    );
    expect(detached.mode).toBe("detached_reading");

    expect(
      reduceTranscriptViewportPolicy(detached, { type: "session_opened" }).mode
    ).toBe("following_tail");
    expect(
      reduceTranscriptViewportPolicy(detached, { type: "explicit_follow" }).mode
    ).toBe("following_tail");
  });

  it("reattaches when the reader reaches the tail and detaches for navigation", () => {
    const detached = reduceTranscriptViewportPolicy(
      INITIAL_TRANSCRIPT_VIEWPORT_POLICY_STATE,
      { type: "explicit_navigation" }
    );
    expect(detached.mode).toBe("detached_reading");
    expect(
      reduceTranscriptViewportPolicy(detached, {
        type: "user_scroll",
        atTail: true,
      }).mode
    ).toBe("following_tail");
    expect(
      reduceTranscriptViewportPolicy(INITIAL_TRANSCRIPT_VIEWPORT_POLICY_STATE, {
        type: "explicit_layout_change",
      }).mode
    ).toBe("detached_reading");
  });
});

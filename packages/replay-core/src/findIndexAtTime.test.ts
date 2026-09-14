import { describe, expect, it } from "vitest";

import type { ReplayEventTimestamp } from "./findIndexAtTime";
import { eventReplayTimeMs, findIndexAtTime } from "./findIndexAtTime";

function makeReplayEventTimestamp(
  overrides: Partial<ReplayEventTimestamp> &
    Pick<ReplayEventTimestamp, "createdAt">
): ReplayEventTimestamp {
  return {
    ...overrides,
  };
}

function eventsAt(...isoTimes: string[]): ReplayEventTimestamp[] {
  return isoTimes.map((createdAt) => makeReplayEventTimestamp({ createdAt }));
}

const T0 = Date.parse("2025-01-01T00:00:00Z");
const T1 = Date.parse("2025-01-01T00:00:01Z");
const T2 = Date.parse("2025-01-01T00:00:02Z");
const T3 = Date.parse("2025-01-01T00:00:03Z");

describe("findIndexAtTime", () => {
  it("returns -1 for empty arrays", () => {
    expect(findIndexAtTime([], 0)).toBe(-1);
    expect(findIndexAtTime([], 0, { preStart: "empty" })).toBe(-1);
  });

  it("clamps cursor-before-first to 0 by default", () => {
    const events = eventsAt("2025-01-01T00:00:01Z", "2025-01-01T00:00:02Z");
    expect(findIndexAtTime(events, T0)).toBe(0);
    expect(findIndexAtTime(events, T0, { preStart: "clamp" })).toBe(0);
  });

  it("returns -1 for cursor-before-first when preStart=empty", () => {
    const events = eventsAt("2025-01-01T00:00:01Z", "2025-01-01T00:00:02Z");
    expect(findIndexAtTime(events, T0, { preStart: "empty" })).toBe(-1);
  });

  it("returns the last index when cursor is past the tail", () => {
    const events = eventsAt(
      "2025-01-01T00:00:00Z",
      "2025-01-01T00:00:01Z",
      "2025-01-01T00:00:02Z"
    );
    expect(findIndexAtTime(events, T3)).toBe(2);
  });

  it("returns the largest index whose timestamp ≤ cursor", () => {
    const events = eventsAt(
      "2025-01-01T00:00:00Z",
      "2025-01-01T00:00:01Z",
      "2025-01-01T00:00:02Z"
    );
    expect(findIndexAtTime(events, T1)).toBe(1);
    expect(findIndexAtTime(events, T1 + 500)).toBe(1);
    expect(findIndexAtTime(events, T2)).toBe(2);
  });

  it("uses lastActivityAt when present (fixes blank final frame)", () => {
    // Tool call started at T0 but the merged result completed at T2. A
    // cursor at T2 must select this event — not fall through to a slice
    // earlier than the call.
    const events: ReplayEventTimestamp[] = [
      Object.assign(
        makeReplayEventTimestamp({ createdAt: "2025-01-01T00:00:00Z" }),
        {
          lastActivityAt: "2025-01-01T00:00:02Z",
        }
      ),
    ];
    expect(findIndexAtTime(events, T2)).toBe(0);
    expect(eventReplayTimeMs(events[0])).toBe(T2);
  });

  it("skips non-finite timestamps without poisoning the search", () => {
    const events: ReplayEventTimestamp[] = [
      makeReplayEventTimestamp({ createdAt: "2025-01-01T00:00:00Z" }),
      makeReplayEventTimestamp({ createdAt: "not-a-date" }),
      makeReplayEventTimestamp({ createdAt: "2025-01-01T00:00:02Z" }),
    ];
    // The corrupt middle entry must not prevent us from finding index 0.
    expect(findIndexAtTime(events, T0)).toBe(0);
    expect(findIndexAtTime(events, T2)).toBe(2);
  });
});

describe("eventReplayTimeMs", () => {
  it("falls back to createdAt when lastActivityAt is missing", () => {
    const event = makeReplayEventTimestamp({
      createdAt: "2025-01-01T00:00:01Z",
    });
    expect(eventReplayTimeMs(event)).toBe(T1);
  });

  it("prefers lastActivityAt over createdAt", () => {
    const event = Object.assign(
      makeReplayEventTimestamp({ createdAt: "2025-01-01T00:00:00Z" }),
      { lastActivityAt: "2025-01-01T00:00:02Z" }
    );
    expect(eventReplayTimeMs(event)).toBe(T2);
  });
});

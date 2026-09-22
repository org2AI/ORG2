import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { makeSessionEvent } from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";

import { canConsolidate, mergeObservations } from "../utils";

describe("canConsolidate", () => {
  it("returns true for same thread_id, same action_type, consecutive parts", () => {
    const first = makeSessionEvent({
      action_type: "tool_call",
      args: { thread_id: "t1", observation_part: "part 1/3" },
    });
    const second = makeSessionEvent({
      action_type: "tool_call",
      args: { thread_id: "t1", observation_part: "part 2/3" },
    });
    expect(canConsolidate(first, second)).toBe(true);
  });

  it("returns false when thread_id differs", () => {
    const first = makeSessionEvent({
      args: { thread_id: "t1", observation_part: "part 1/3" },
    });
    const second = makeSessionEvent({
      args: { thread_id: "t2", observation_part: "part 2/3" },
    });
    expect(canConsolidate(first, second)).toBe(false);
  });

  it("returns false when action_type differs", () => {
    const first = makeSessionEvent({
      action_type: "tool_call",
      args: { thread_id: "t1", observation_part: "part 1/3" },
    });
    const second = makeSessionEvent({
      action_type: "assistant",
      args: { thread_id: "t1", observation_part: "part 2/3" },
    });
    expect(canConsolidate(first, second)).toBe(false);
  });

  it("returns false for non-consecutive parts (1/3 then 3/3)", () => {
    const first = makeSessionEvent({
      args: { thread_id: "t1", observation_part: "part 1/3" },
    });
    const second = makeSessionEvent({
      args: { thread_id: "t1", observation_part: "part 3/3" },
    });
    expect(canConsolidate(first, second)).toBe(false);
  });

  it("returns false when observation_part is missing", () => {
    const first = makeSessionEvent({
      args: { thread_id: "t1" },
    });
    const second = makeSessionEvent({
      args: { thread_id: "t1", observation_part: "part 2/3" },
    });
    expect(canConsolidate(first, second)).toBe(false);
  });

  it("returns false when one activity is missing thread_id", () => {
    const first = makeSessionEvent({
      args: { thread_id: "t1", observation_part: "part 1/3" },
    });
    const second = makeSessionEvent({
      args: { observation_part: "part 2/3" },
    });
    expect(canConsolidate(first, second)).toBe(false);
  });
});

describe("mergeObservations", () => {
  it("merges observation strings with newline", () => {
    const activities: SessionEvent[] = [
      makeSessionEvent({ result: { observation: "line one" } }),
      makeSessionEvent({ result: { observation: "line two" } }),
      makeSessionEvent({ result: { observation: "line three" } }),
    ];
    expect(mergeObservations(activities)).toBe(
      "line one\nline two\nline three"
    );
  });

  it("skips empty observations", () => {
    const activities: SessionEvent[] = [
      makeSessionEvent({ result: { observation: "first" } }),
      makeSessionEvent({ result: { observation: "" } }),
      makeSessionEvent({ result: { observation: "third" } }),
    ];
    expect(mergeObservations(activities)).toBe("first\nthird");
  });

  it("returns empty string for empty array", () => {
    expect(mergeObservations([])).toBe("");
  });

  it("returns empty string when all observations are empty", () => {
    const activities: SessionEvent[] = [
      makeSessionEvent({ result: {} }),
      makeSessionEvent({ result: { observation: "" } }),
    ];
    expect(mergeObservations(activities)).toBe("");
  });
});

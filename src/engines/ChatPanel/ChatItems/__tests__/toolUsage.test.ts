import { describe, expect, it } from "vitest";

import {
  TOOL_USAGE_ARGS_KEY,
  type ToolUsageMetadata,
} from "@src/engines/SessionCore/core/types";
import { makeSessionEvent } from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";

import { readToolUsage, sumToolUsage } from "../toolUsage";

function makeUsage(
  overrides: Partial<ToolUsageMetadata> = {}
): ToolUsageMetadata {
  return {
    decisionCompletionTokens: 1,
    resultContextTokens: 2,
    followupCompletionTokens: 3,
    inputBytes: 4,
    outputBytes: 5,
    relatedCacheReadTokens: 6,
    relatedCacheWriteTokens: 7,
    attributionMethod: "exact",
    ...overrides,
  };
}

describe("readToolUsage", () => {
  it("prefers the typed toolUsage field", () => {
    const typed = makeUsage({ inputBytes: 40 });
    const event = {
      ...makeSessionEvent({
        args: { [TOOL_USAGE_ARGS_KEY]: makeUsage({ inputBytes: 99 }) },
      }),
      toolUsage: typed,
    };

    expect(readToolUsage(event)).toBe(typed);
  });

  it("falls back to the raw args slot", () => {
    const raw = makeUsage({ outputBytes: 50 });
    const event = makeSessionEvent({ args: { [TOOL_USAGE_ARGS_KEY]: raw } });

    expect(readToolUsage(event)).toBe(raw);
  });

  it("returns undefined when neither source is an object", () => {
    expect(readToolUsage(makeSessionEvent())).toBeUndefined();
    expect(
      readToolUsage(makeSessionEvent({ args: { [TOOL_USAGE_ARGS_KEY]: "x" } }))
    ).toBeUndefined();
  });
});

describe("sumToolUsage", () => {
  it("returns undefined for empty input", () => {
    expect(sumToolUsage([])).toBeUndefined();
  });

  it("returns undefined when no entry carries usage", () => {
    expect(sumToolUsage([undefined, undefined])).toBeUndefined();
  });

  it("sums every numeric field and ignores entries without usage", () => {
    const total = sumToolUsage([
      makeUsage(),
      undefined,
      makeUsage({
        decisionCompletionTokens: 10,
        resultContextTokens: 20,
        followupCompletionTokens: 30,
        inputBytes: 40,
        outputBytes: 50,
        relatedCacheReadTokens: 60,
        relatedCacheWriteTokens: 70,
      }),
    ]);

    expect(total).toEqual({
      decisionCompletionTokens: 11,
      resultContextTokens: 22,
      followupCompletionTokens: 33,
      inputBytes: 44,
      outputBytes: 55,
      relatedCacheReadTokens: 66,
      relatedCacheWriteTokens: 77,
      attributionMethod: "exact",
    });
  });

  it("keeps a shared attributionMethod and otherwise takes the last one", () => {
    expect(sumToolUsage([makeUsage(), makeUsage()])?.attributionMethod).toBe(
      "exact"
    );
    expect(
      sumToolUsage([
        makeUsage({ attributionMethod: "exact" }),
        makeUsage({ attributionMethod: "estimated" }),
      ])?.attributionMethod
    ).toBe("estimated");
  });
});

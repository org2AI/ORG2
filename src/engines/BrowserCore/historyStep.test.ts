import { describe, expect, it } from "vitest";

import { resolveHistoryStep } from "./historyStep";

const HISTORY = ["https://a.example", "https://b.example", "https://c.example"];

describe("resolveHistoryStep", () => {
  it("reads one step down the same history as Back", () => {
    expect(
      resolveHistoryStep(
        { history: HISTORY, index: 2 },
        { history: HISTORY, index: 1 },
        "https://b.example"
      )
    ).toBe("back");
  });

  it("reads one step up the same history as Forward", () => {
    expect(
      resolveHistoryStep(
        { history: HISTORY, index: 0 },
        { history: HISTORY, index: 1 },
        "https://b.example"
      )
    ).toBe("forward");
  });

  it("treats a URL typed again at the next index as a fresh navigation", () => {
    // handleNavigate from index 0 rebuilds the array as [a, b]: same entries,
    // index + 1, but the user asked for a load, not a restored page.
    const rebuilt = [...HISTORY.slice(0, 1), "https://b.example"];
    expect(
      resolveHistoryStep(
        { history: HISTORY, index: 0 },
        { history: rebuilt, index: 1 },
        "https://b.example"
      )
    ).toBeNull();
  });

  it("ignores a cursor that did not move or jumped more than one entry", () => {
    expect(
      resolveHistoryStep(
        { history: HISTORY, index: 1 },
        { history: HISTORY, index: 1 },
        "https://b.example"
      )
    ).toBeNull();
    expect(
      resolveHistoryStep(
        { history: HISTORY, index: 2 },
        { history: HISTORY, index: 0 },
        "https://a.example"
      )
    ).toBeNull();
  });

  it("ignores a step whose URL is not the entry under the cursor", () => {
    expect(
      resolveHistoryStep(
        { history: HISTORY, index: 2 },
        { history: HISTORY, index: 1 },
        "https://elsewhere.example"
      )
    ).toBeNull();
  });
});

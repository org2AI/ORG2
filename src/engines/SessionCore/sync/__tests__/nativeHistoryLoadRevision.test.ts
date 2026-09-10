import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadWithNativeHistoryRevision } from "../nativeHistoryLoadRevision";

const mocks = vi.hoisted(() => ({
  revision: vi.fn(),
  generation: 0,
  active: false,
}));
vi.mock("../nativeConversationRevision", () => ({
  loadNativeConversationRevision: mocks.revision,
}));
vi.mock("../../control/turnLifecycle", () => ({
  getTurnGeneration: () => mocks.generation,
  isTurnActive: () => mocks.active,
}));

describe("native history load revision", () => {
  beforeEach(() => {
    mocks.revision.mockReset().mockResolvedValue("v1");
    mocks.generation = 0;
    mocks.active = false;
  });
  it("certifies only a revision observed on both sides of the actual read", async () => {
    const events = [{ id: "native" }];
    const result = await loadWithNativeHistoryRevision(
      "cli-a",
      new AbortController().signal,
      async () => {
        expect(mocks.revision).toHaveBeenCalledTimes(1);
        return events;
      }
    );
    expect(result.value).toBe(events);
    expect(result.nativeHistoryRevision).toEqual({
      revision: "v1",
      generation: 0,
    });
    expect(mocks.revision).toHaveBeenCalledTimes(2);
  });
  it.each(["append", "abort", "generation", "active"])(
    "does not certify after %s during load",
    async (change) => {
      const controller = new AbortController();
      const result = await loadWithNativeHistoryRevision(
        "cli-a",
        controller.signal,
        async () => {
          if (change === "append") mocks.revision.mockResolvedValue("v2");
          if (change === "abort") controller.abort();
          if (change === "generation") mocks.generation++;
          if (change === "active") mocks.active = true;
          return [];
        }
      );
      expect(result.nativeHistoryRevision).toBeUndefined();
    }
  );
  it("preserves initial loading when stat probing fails", async () => {
    mocks.revision.mockRejectedValue(new Error("unavailable"));
    const load = vi.fn(async () => ["history"]);
    const result = await loadWithNativeHistoryRevision(
      "cli-a",
      new AbortController().signal,
      load
    );
    expect(result).toEqual({
      value: ["history"],
      nativeHistoryRevision: undefined,
    });
    expect(load).toHaveBeenCalledOnce();
  });
});

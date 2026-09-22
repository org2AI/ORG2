// @vitest-environment jsdom
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { SearchQuery, search } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyReviewSearch } from "./reviewSearchNavigation";

let host: HTMLDivElement;
const cleanup: (() => void)[] = [];
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  vi.useFakeTimers();
  for (const [proto, key, value] of [
    [HTMLElement.prototype, "scrollIntoView", vi.fn()],
    [Range.prototype, "getClientRects", () => []],
    [Range.prototype, "getBoundingClientRect", () => new DOMRect()],
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    Object.defineProperty(proto, key, { configurable: true, value });
    cleanup.push(() => {
      if (descriptor) Object.defineProperty(proto, key, descriptor);
      else Reflect.deleteProperty(proto, key);
    });
  }
});
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("review match navigation", () => {
  it("selects the matching side of a split diff", () => {
    const split = new MergeView({
      parent: host,
      a: { doc: "old needle", extensions: [search()] },
      b: { doc: "new needle", extensions: [search()] },
    });
    cleanup.push(() => split.destroy());
    cleanup.push(
      applyReviewSearch(
        null,
        split,
        {
          query: new SearchQuery({ search: "needle" }),
          match: { side: "old", from: 4, to: 10 },
        },
        false
      )
    );
    expect(split.a.state.selection.main.from).toBe(4);
    expect(split.a.state.selection.main.to).toBe(10);
    expect(split.b.state.selection.main.empty).toBe(true);
  });
  it("reveals the deleted line in a unified diff and cleans up its highlight", async () => {
    const view = new EditorView({
      parent: host,
      doc: "same\nadded\nend",
      extensions: [
        search(),
        unifiedMergeView({
          original: "same\nremoved needle\nend",
          mergeControls: false,
        }),
      ],
    });
    cleanup.push(() => view.destroy());
    const dispose = applyReviewSearch(
      view,
      null,
      {
        query: new SearchQuery({ search: "needle" }),
        match: { side: "old", from: 13, to: 19 },
      },
      false
    );
    cleanup.push(dispose);
    await vi.advanceTimersByTimeAsync(50);
    expect(
      host.querySelector(".cm-review-search-match")?.textContent
    ).toContain("removed needle");
    dispose();
    expect(host.querySelector(".cm-review-search-match")).toBeNull();
  });
  it("handles a fully deleted file whose original is the displayed document", () => {
    const view = new EditorView({
      parent: host,
      doc: "deleted needle",
      extensions: [search(), unifiedMergeView({ original: "" })],
    });
    cleanup.push(() => view.destroy());
    cleanup.push(
      applyReviewSearch(
        view,
        null,
        {
          query: new SearchQuery({ search: "needle" }),
          match: { side: "old", from: 8, to: 14 },
        },
        true
      )
    );
    expect(view.state.selection.main.from).toBe(8);
    expect(view.state.selection.main.to).toBe(14);
  });
});

// @vitest-environment jsdom
import { EditorView, lineNumbers } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dirtyDiffGutter } from "./dirtyDiff";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const mounted: EditorView[] = [];
function editor() {
  const view = new EditorView({
    parent: document.body,
    doc: "new\nchanged\nsame",
    extensions: [lineNumbers(), dirtyDiffGutter({ current: "old\nsame" })],
  });
  mounted.push(view);
  return view;
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.invoke.mockReset();
});
afterEach(() => {
  mounted.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("dirty diff rendering", () => {
  it("marks the number gutter and code row from the backend result", async () => {
    mocks.invoke.mockResolvedValue({
      markers: [
        { line: 1, type: "added" },
        { line: 2, type: "modified" },
        { line: 3, type: "deleted" },
      ],
    });
    const view = editor();
    await vi.advanceTimersByTimeAsync(50);
    expect(
      view.dom.querySelector(".cm-lineNumbers .cm-dirty-diff-row-added")
        ?.textContent
    ).toBe("1");
    expect(
      view.dom.querySelector(".cm-lineNumbers .cm-dirty-diff-row-modified")
        ?.textContent
    ).toBe("2");
    expect(
      view.dom.querySelector(".cm-line.cm-dirty-diff-row-added")?.textContent
    ).toBe("new");
    // A deletion anchor points to surviving text, not a deleted code row.
    expect(
      view.dom.querySelector(".cm-line.cm-dirty-diff-row-deleted")
    ).toBeNull();
    expect(view.dom.querySelector(".cm-dirty-diff-deleted")).not.toBeNull();
  });
});

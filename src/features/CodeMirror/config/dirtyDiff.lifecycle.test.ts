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
const result = (line: number, type = "added") => ({
  markers: [{ line, type }],
});
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
  it("rejects a result for an obsolete document before applying fresh markers", async () => {
    let resolve!: (value: ReturnType<typeof result>) => void;
    mocks.invoke
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        })
      )
      .mockResolvedValueOnce(result(2, "modified"));
    const view = editor();
    await vi.advanceTimersByTimeAsync(50);
    view.dispatch({ changes: { from: 0, to: 3, insert: "latest" } });
    resolve(result(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(view.dom.querySelector(".cm-dirty-diff-added")).toBeNull();
    await vi.advanceTimersByTimeAsync(150);
    expect(view.dom.querySelector(".cm-dirty-diff-modified")).not.toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("preserves existing markers on backend failure and stops work on close", async () => {
    mocks.invoke
      .mockResolvedValueOnce(result(1))
      .mockRejectedValueOnce(new Error("offline"));
    const view = editor();
    await vi.advanceTimersByTimeAsync(50);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    await vi.advanceTimersByTimeAsync(150);
    expect(view.dom.querySelector(".cm-dirty-diff-added")).not.toBeNull();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    view.destroy();
    mounted.pop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});

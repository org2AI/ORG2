// @vitest-environment jsdom
import {
  MergeView,
  getOriginalDoc,
  originalDocChangeEffect,
  unifiedMergeView,
} from "@codemirror/merge";
import { ChangeSet } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { activeChangedRowGutter } from "./activeChangedRow";

const mounted: { destroy(): void }[] = [];
const extensions = [
  lineNumbers(),
  highlightActiveLineGutter(),
  activeChangedRowGutter,
];
const cursorAt = (view: EditorView, line: number) =>
  view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
/** Text of every gutter cell tagged as a current added/deleted row. */
const tagged = (view: EditorView) =>
  Array.from(
    view.dom.querySelectorAll(".cm-lineNumbers .cm-activeChangedGutter"),
    (cell) => cell.textContent
  );

afterEach(() => {
  mounted.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("activeChangedRowGutter", () => {
  it("tags the current row only while it is an added or deleted line", () => {
    const merge = new MergeView({
      parent: document.body,
      a: { doc: "same\nold\ntail", extensions },
      b: { doc: "same\nnew\ntail", extensions },
      gutter: true,
    });
    mounted.push(merge);
    expect(tagged(merge.a)).toEqual([]);

    cursorAt(merge.a, 2);
    cursorAt(merge.b, 2);
    expect(tagged(merge.a)).toEqual(["2"]);
    expect(tagged(merge.b)).toEqual(["2"]);
    // Every gutter column of the row is tagged, not just the numbers.
    expect(
      merge.b.dom.querySelectorAll(".cm-changeGutter .cm-activeChangedGutter")
        .length
    ).toBe(1);

    cursorAt(merge.b, 3);
    expect(tagged(merge.b)).toEqual([]);
    expect(
      merge.b.dom.querySelectorAll(".cm-activeLineGutter").length
    ).toBeGreaterThan(0);
  });

  it("clears the tag when the chunk goes away without the cursor moving", () => {
    const view = new EditorView({
      parent: document.body,
      doc: "same\nadded\ntail",
      extensions: [...extensions, unifiedMergeView({ original: "same\ntail" })],
    });
    mounted.push(view);
    cursorAt(view, 2);
    expect(tagged(view)).toEqual(["2"]);

    view.dispatch({
      effects: originalDocChangeEffect(
        view.state,
        ChangeSet.of(
          { from: 5, insert: "added\n" },
          getOriginalDoc(view.state).length
        )
      ),
    });
    expect(tagged(view)).toEqual([]);
  });
});

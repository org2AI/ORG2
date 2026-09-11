// @vitest-environment jsdom
import {
  MergeView,
  getOriginalDoc,
  originalDocChangeEffect,
  unifiedMergeView,
} from "@codemirror/merge";
import { ChangeSet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { diffLineNumbers } from "./diffLineNumbers";

const mounted: { destroy(): void }[] = [];
const numbers = (view: EditorView, className: string) =>
  Array.from(
    view.dom.querySelectorAll(`.cm-lineNumbers .${className}`),
    (element) => element.textContent
  );

afterEach(() => {
  mounted.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("diffLineNumbers", () => {
  it("marks additions and clears them when the original catches up", () => {
    const view = new EditorView({
      parent: document.body,
      doc: "same\nadded\ntail",
      extensions: [
        diffLineNumbers({ formatNumber: (line) => String(line + 40) }),
        unifiedMergeView({ original: "same\ntail" }),
      ],
    });
    mounted.push(view);
    expect(numbers(view, "cm-diffAddedNumber")).toEqual(["42"]);
    view.dispatch({
      effects: originalDocChangeEffect(
        view.state,
        ChangeSet.of(
          { from: 5, insert: "added\n" },
          getOriginalDoc(view.state).length
        )
      ),
    });
    expect(numbers(view, "cm-diffAddedNumber")).toEqual([]);
  });

  it("marks the old and new numbers independently in split view", () => {
    const extension = diffLineNumbers({ formatNumber: String });
    const merge = new MergeView({
      parent: document.body,
      a: { doc: "same\nold\ntail", extensions: [extension] },
      b: { doc: "same\nnew\ntail", extensions: [extension] },
    });
    mounted.push(merge);
    expect(numbers(merge.a, "cm-diffDeletedNumber")).toEqual(["2"]);
    expect(numbers(merge.b, "cm-diffAddedNumber")).toEqual(["2"]);
    expect(numbers(merge.a, "cm-diffAddedNumber")).toEqual([]);
  });

  it("refreshes relative labels when only the selection changes", () => {
    const view = new EditorView({
      parent: document.body,
      doc: "same\nadded\ntail",
      extensions: [
        diffLineNumbers({
          formatNumber: (line, state) =>
            String(
              Math.abs(
                line - state.doc.lineAt(state.selection.main.head).number
              )
            ),
        }),
        unifiedMergeView({ original: "same\ntail" }),
      ],
    });
    mounted.push(view);
    expect(numbers(view, "cm-diffAddedNumber")).toEqual(["1"]);
    view.dispatch({ selection: { anchor: 5 } });
    expect(numbers(view, "cm-diffAddedNumber")).toEqual(["0"]);
  });

  it("formats only rendered rows in a large changed document", () => {
    const formatNumber = vi.fn(String);
    const view = new EditorView({
      parent: document.body,
      doc: "new\n".repeat(10_000),
      extensions: [
        diffLineNumbers({ formatNumber }),
        unifiedMergeView({ original: "old\n" }),
      ],
    });
    mounted.push(view);
    expect(numbers(view, "cm-diffAddedNumber").length).toBeGreaterThan(0);
    expect(formatNumber.mock.calls.length).toBeLessThan(200);
  });
});

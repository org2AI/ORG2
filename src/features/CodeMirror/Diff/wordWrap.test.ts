// @vitest-environment jsdom
import { unifiedMergeView } from "@codemirror/merge";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { compile } from "sass";
import { afterEach, describe, expect, it } from "vitest";

const diffCss = compile(`${import.meta.dirname}/index.scss`, {
  logger: { warn() {}, debug() {} },
}).css;

let view: EditorView | undefined;
let style: HTMLStyleElement | undefined;

afterEach(() => {
  view?.destroy();
  style?.remove();
  document.body.replaceChildren();
});

describe("diff word wrap", () => {
  it("lets deleted lines inherit the content wrap mode when toggled", () => {
    style = document.createElement("style");
    style.textContent = diffCss;
    document.head.append(style);
    const parent = document.createElement("div");
    parent.className = "codemirror-diff";
    document.body.append(parent);
    const wrapping = new Compartment();
    view = new EditorView({
      parent,
      doc: "unchanged\nnew content\ntail",
      extensions: [
        wrapping.of([]),
        unifiedMergeView({
          original: `unchanged\n  ${"old content ".repeat(30)}\ntail`,
          mergeControls: false,
          allowInlineDiffs: false,
        }),
      ],
    });

    for (const enabled of [false, true, false]) {
      view.dispatch({
        effects: wrapping.reconfigure(enabled ? EditorView.lineWrapping : []),
      });
      expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(
        enabled
      );
      expect(getComputedStyle(view.contentDOM).whiteSpace).toBe(
        enabled ? "break-spaces" : "pre"
      );
      const deletedLine = view.dom.querySelector(".cm-deletedLine");
      expect(deletedLine).not.toBeNull();
      // jsdom does not reliably resolve inherited styles or perform layout.
      // Check the matching compiled rule at the real widget and its parent mode.
      const whiteSpaceRules = Array.from(style.sheet!.cssRules)
        .filter((rule): rule is CSSStyleRule => "selectorText" in rule)
        .filter(
          (rule) =>
            !rule.selectorText.includes(":global") &&
            rule.style.getPropertyValue("white-space") &&
            deletedLine!.matches(rule.selectorText)
        );
      expect(whiteSpaceRules.length).toBeGreaterThan(0);
      expect(
        whiteSpaceRules.map((rule) =>
          rule.style.getPropertyValue("white-space")
        )
      ).toEqual(["inherit"]);
    }
  });
});

import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutterWidgetClass,
} from "@codemirror/view";
import type { BlockInfo, WidgetType } from "@codemirror/view";

import {
  COLLAPSE_EXPAND_STEP,
  expandCollapsedRange,
  incrementalCollapse,
} from "./incrementalCollapse";

function isCollapsed(widget: WidgetType) {
  return "type" in widget && widget.type === "collapsed-unchanged-code";
}

class CollapsedRow extends GutterMarker {
  constructor(
    readonly from: number,
    readonly split: boolean
  ) {
    super();
    this.elementClass = `cm-collapsedGutter cm-collapsedAt-${from}${split ? " cm-collapsedGutter--split" : ""}`;
  }
  eq(other: CollapsedRow) {
    return this.from === other.from && this.split === other.split;
  }
}

function highlightCollapsedRow(view: EditorView, target: EventTarget | null) {
  const element =
    target instanceof Element && view.dom.contains(target) ? target : null;
  const content = element?.closest(".cm-collapsedLines");
  const gutter = element?.closest(".cm-collapsedGutter");
  const positionClass =
    gutter &&
    Array.from(gutter.classList).find((name) =>
      name.startsWith("cm-collapsedAt-")
    );
  const from = content
    ? view.posAtDOM(content)
    : positionClass
      ? Number(positionClass.slice("cm-collapsedAt-".length))
      : null;
  for (const row of view.dom.querySelectorAll(
    ".cm-collapsedRowHovered, .cm-collapsedRowHoverTop, .cm-collapsedRowHoverBottom"
  )) {
    row.classList.remove(
      "cm-collapsedRowHovered",
      "cm-collapsedRowHoverTop",
      "cm-collapsedRowHoverBottom"
    );
  }
  if (from === null) return;
  const arrow = element?.closest(".cm-collapseArrow");
  const half =
    gutter?.classList.contains("cm-collapsedGutter--split") && arrow
      ? arrow.classList.contains("cm-collapseArrow--down")
        ? "cm-collapsedRowHoverTop"
        : "cm-collapsedRowHoverBottom"
      : null;
  for (const row of view.dom.querySelectorAll(`.cm-collapsedAt-${from}`)) {
    row.classList.add(half ?? "cm-collapsedRowHovered");
  }
  if (half) return;
  for (const row of view.contentDOM.querySelectorAll(".cm-collapsedLines")) {
    if (view.posAtDOM(row) === from)
      row.classList.add("cm-collapsedRowHovered");
  }
}

export const collapsedGutterBackground = [
  incrementalCollapse,
  gutterWidgetClass.of((view, widget, block) =>
    isCollapsed(widget)
      ? new CollapsedRow(
          block.from,
          block.from > 0 && block.to < view.state.doc.length
        )
      : null
  ),
  // Event-driven only: no layout reads, observers, timers, or retained nodes.
  ViewPlugin.fromClass(
    class {
      private enter = (event: MouseEvent | FocusEvent) =>
        highlightCollapsedRow(this.view, event.target);
      private leave = (event: MouseEvent | FocusEvent) =>
        highlightCollapsedRow(this.view, event.relatedTarget);
      constructor(private view: EditorView) {
        // Native content handlers do not receive gutter events, and merge
        // widgets ignore mouse events. Delegate from the editor root instead.
        view.dom.addEventListener("mouseover", this.enter);
        view.dom.addEventListener("mouseout", this.leave);
        view.dom.addEventListener("focusin", this.enter);
        view.dom.addEventListener("focusout", this.leave);
      }
      destroy() {
        this.view.dom.removeEventListener("mouseover", this.enter);
        this.view.dom.removeEventListener("mouseout", this.leave);
        this.view.dom.removeEventListener("focusin", this.enter);
        this.view.dom.removeEventListener("focusout", this.leave);
      }
    }
  ),
];

class CollapseControl extends GutterMarker {
  constructor(
    readonly from: number,
    readonly to: number
  ) {
    super();
  }

  eq(other: CollapseControl) {
    return this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView) {
    const control = document.createElement("div");
    control.className = "cm-collapseControl";
    const lines =
      view.state.doc.lineAt(this.to).number -
      view.state.doc.lineAt(this.from).number +
      1;
    const directions =
      this.from === 0
        ? ["up"]
        : this.to === view.state.doc.length
          ? ["down"]
          : ["down", "up"];
    for (const direction of directions) {
      const button = control.appendChild(document.createElement("button"));
      button.type = "button";
      button.className = `cm-collapseArrow cm-collapseArrow--${direction}`;
      button.setAttribute(
        "aria-label",
        view.state.phrase(
          "$ unchanged lines",
          Math.min(COLLAPSE_EXPAND_STEP, lines)
        )
      );
      button.addEventListener("click", () => {
        expandCollapsedRange(
          view,
          { from: this.from, to: this.to },
          direction === "down" ? "start" : "end"
        );
      });
    }
    return control;
  }
}

export function collapsedNumberControl(
  _view: EditorView,
  widget: WidgetType,
  block: BlockInfo
) {
  return isCollapsed(widget) ? new CollapseControl(block.from, block.to) : null;
}

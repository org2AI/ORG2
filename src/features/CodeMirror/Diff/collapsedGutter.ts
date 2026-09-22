import { mergeViewSiblings } from "@codemirror/merge";
import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutterWidgetClass,
} from "@codemirror/view";
import type { BlockInfo, WidgetType } from "@codemirror/view";

import { ArrowDown01Icon, ArrowUp01Icon, UnfoldMoreIcon } from "@src/icons";

import { createGutterIcon } from "../shared/createGutterIcon";
import {
  COLLAPSED_COMPACT_ROW_PX,
  COLLAPSE_EXPAND_STEP,
  expandCollapsedRange,
  incrementalCollapse,
} from "./incrementalCollapse";

// Separate directions only when two expansion steps cannot reveal the whole gap.
const COLLAPSE_SPLIT_THRESHOLD = COLLAPSE_EXPAND_STEP * 2;
export const COLLAPSED_SPLIT_ROW_CLASS = "cm-collapsedLines--split";

const alignedEstimates = new WeakSet<object>();

/**
 * @codemirror/merge's own collapse widget (not exported) estimates 27px. In
 * split view, spacer updates next to a collapsed row rebuild its height-map
 * node from that estimate without the row's DOM changing, so CodeMirror never
 * re-measures it and the gutter drifts from our fixed-height row. Report the
 * real compact height instead, as our own widget does.
 */
function alignCollapsedEstimate(widget: WidgetType) {
  const proto = Object.getPrototypeOf(widget) as object;
  if (alignedEstimates.has(proto)) return;
  alignedEstimates.add(proto);
  if (widget.estimatedHeight === COLLAPSED_COMPACT_ROW_PX) return;
  Object.defineProperty(proto, "estimatedHeight", {
    configurable: true,
    get: () => COLLAPSED_COMPACT_ROW_PX,
  });
}

function isCollapsed(widget: WidgetType) {
  const collapsed =
    "type" in widget && widget.type === "collapsed-unchanged-code";
  if (collapsed) alignCollapsedEstimate(widget);
  return collapsed;
}

function hiddenLineCount(view: EditorView, from: number, to: number) {
  return (
    view.state.doc.lineAt(to).number - view.state.doc.lineAt(from).number + 1
  );
}

function isSplitCollapsedBlock(view: EditorView, block: BlockInfo) {
  return (
    block.from > 0 &&
    block.to < view.state.doc.length &&
    hiddenLineCount(view, block.from, block.to) > COLLAPSE_SPLIT_THRESHOLD
  );
}

interface CollapsedRowVariant {
  row: HTMLElement;
  split: boolean;
}

/** Read the rendered gutter contract after CodeMirror has updated both trees. */
function readCollapsedRowVariants(view: EditorView): CollapsedRowVariant[] {
  const splitPositions = new Set<number>();
  for (const gutter of view.dom.querySelectorAll(
    ".cm-collapsedGutter--split"
  )) {
    const positionClass = Array.from(gutter.classList).find((name) =>
      name.startsWith("cm-collapsedAt-")
    );
    if (positionClass) {
      splitPositions.add(Number(positionClass.slice("cm-collapsedAt-".length)));
    }
  }
  return Array.from(
    view.contentDOM.querySelectorAll<HTMLElement>(".cm-collapsedLines"),
    (row) => ({ row, split: splitPositions.has(view.posAtDOM(row)) })
  );
}

/** Keep content sizing tied to the gutter control variant, not DOM position. */
function writeCollapsedRowVariants(
  view: EditorView,
  variants: readonly CollapsedRowVariant[]
) {
  let changed = false;
  for (const { row, split } of variants) {
    if (row.classList.contains(COLLAPSED_SPLIT_ROW_CLASS) === split) continue;
    row.classList.toggle(COLLAPSED_SPLIT_ROW_CLASS, split);
    changed = true;
  }
  if (changed) view.requestMeasure();
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

const HOVER_CLASS = "cm-collapsedRowHovered";

function collapsedRows(view: EditorView) {
  return Array.from(
    view.contentDOM.querySelectorAll<HTMLElement>(".cm-collapsedLines")
  );
}

/**
 * A two-arrow row offers three actions (step down, step up, expand all), so
 * its arrows and its label highlight separately: the arrows by their own CSS
 * hover, the label bar through the row class. This is the gutter area behind
 * those arrows. The new pane of a split diff hides them, so its gutter is
 * just more of the label bar.
 */
function isSplitArrowArea(view: EditorView, element: Element) {
  const cell = element.closest(".cm-collapsedGutter--split");
  if (!cell?.closest(".cm-gutters-before")) return false;
  return mergeViewSiblings(view)?.b !== view;
}

/** Paint one editor's part of a collapsed row (gutter cells + content row). */
function markCollapsedRow(view: EditorView, from: number | null) {
  for (const row of view.dom.querySelectorAll(`.${HOVER_CLASS}`)) {
    row.classList.remove(HOVER_CLASS);
  }
  if (from === null) return;
  for (const row of view.dom.querySelectorAll(`.cm-collapsedAt-${from}`)) {
    if (!isSplitArrowArea(view, row)) row.classList.add(HOVER_CLASS);
  }
  for (const row of collapsedRows(view)) {
    if (view.posAtDOM(row) === from) row.classList.add(HOVER_CLASS);
  }
}

/**
 * Hovering a collapsed row highlights the whole row, except on two-arrow
 * rows, where the arrows stay out of it (see isSplitArrowArea).
 */
function highlightCollapsedRow(view: EditorView, target: EventTarget | null) {
  const element =
    target instanceof Element && view.dom.contains(target) ? target : null;
  const content = element?.closest(".cm-collapsedLines");
  const gutter =
    element && !isSplitArrowArea(view, element)
      ? element.closest(".cm-collapsedGutter")
      : null;
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
  markCollapsedRow(view, from);
  // Split view draws one shared row across both panes. Expansion keeps the
  // panes' collapsed rows paired in order, so the sibling's row at the same
  // index is the other half of this one.
  const siblings = mergeViewSiblings(view);
  const sibling = siblings && (siblings.a === view ? siblings.b : siblings.a);
  if (!sibling) return;
  const index =
    from === null
      ? -1
      : collapsedRows(view).findIndex((row) => view.posAtDOM(row) === from);
  const pairedRow = index >= 0 ? collapsedRows(sibling)[index] : undefined;
  markCollapsedRow(sibling, pairedRow ? sibling.posAtDOM(pairedRow) : null);
}

/**
 * Edge rows (file start / end) only open toward the code, so a click on their
 * label steps like their arrow instead of revealing the whole block at once.
 * Runs in the capture phase so it wins over the widgets' expand-all handlers.
 */
function stepEdgeRowFromLabel(view: EditorView, event: MouseEvent) {
  const row =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>(".cm-collapsedLines")
      : null;
  if (!row || !view.contentDOM.contains(row)) return;
  const block = view.lineBlockAt(view.posAtDOM(row));
  const side =
    block.from === 0
      ? "end"
      : block.to === view.state.doc.length
        ? "start"
        : null;
  if (!side) return;
  event.preventDefault();
  event.stopPropagation();
  expandCollapsedRange(view, { from: block.from, to: block.to }, side);
}

export const collapsedGutterBackground = [
  incrementalCollapse,
  gutterWidgetClass.of((view, widget, block) =>
    isCollapsed(widget)
      ? new CollapsedRow(block.from, isSplitCollapsedBlock(view, block))
      : null
  ),
  // Event-driven only: no layout reads, observers, timers, or retained nodes.
  ViewPlugin.fromClass(
    class {
      private enter = (event: MouseEvent | FocusEvent) =>
        highlightCollapsedRow(this.view, event.target);
      private leave = (event: MouseEvent | FocusEvent) =>
        highlightCollapsedRow(this.view, event.relatedTarget);
      private click = (event: MouseEvent) =>
        stepEdgeRowFromLabel(this.view, event);
      private requestVariantSync = () => {
        this.view.requestMeasure({
          key: this,
          read: () => readCollapsedRowVariants(this.view),
          write: (variants) => writeCollapsedRowVariants(this.view, variants),
        });
      };
      constructor(private view: EditorView) {
        // Native content handlers do not receive gutter events, and merge
        // widgets ignore mouse events. Delegate from the editor root instead.
        view.dom.addEventListener("mouseover", this.enter);
        view.dom.addEventListener("mouseout", this.leave);
        view.dom.addEventListener("focusin", this.enter);
        view.dom.addEventListener("focusout", this.leave);
        view.dom.addEventListener("click", this.click, true);
        this.requestVariantSync();
      }
      docViewUpdate() {
        this.requestVariantSync();
      }
      destroy() {
        this.view.dom.removeEventListener("mouseover", this.enter);
        this.view.dom.removeEventListener("mouseout", this.leave);
        this.view.dom.removeEventListener("focusin", this.enter);
        this.view.dom.removeEventListener("focusout", this.leave);
        this.view.dom.removeEventListener("click", this.click, true);
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
    // GutterMarker is a CodeMirror-owned, non-React DOM boundary, so these
    // controls cannot use the shared React Button component.
    const control = document.createElement("div");
    control.className = "cm-collapseControl";
    const lines = hiddenLineCount(view, this.from, this.to);
    const directions =
      this.from === 0
        ? ["up"]
        : this.to === view.state.doc.length
          ? ["down"]
          : lines <= COLLAPSE_SPLIT_THRESHOLD
            ? ["all"]
            : ["down", "up"];
    for (const direction of directions) {
      const button = control.appendChild(document.createElement("button"));
      button.appendChild(
        createGutterIcon(
          direction === "all"
            ? UnfoldMoreIcon
            : direction === "down"
              ? ArrowDown01Icon
              : ArrowUp01Icon
        )
      );
      button.type = "button";
      button.className = `cm-collapseArrow cm-collapseArrow--${direction}`;
      button.setAttribute(
        "aria-label",
        view.state.phrase(
          "$ unchanged lines",
          direction === "all" ? lines : Math.min(COLLAPSE_EXPAND_STEP, lines)
        )
      );
      button.addEventListener("click", () => {
        expandCollapsedRange(
          view,
          { from: this.from, to: this.to },
          direction === "all" ? "all" : direction === "down" ? "start" : "end"
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

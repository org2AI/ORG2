/** Preview figures for the Code Editor settings rows (one per state). */
import React from "react";

import type { EditorLineNumbers } from "@src/store/ui/editorSettingsAtom";
import type { DiffViewMode } from "@src/types/git/types";

import {
  Bar,
  CODE_X,
  Caret,
  Frame,
  LineNumber,
  MID,
  ROW_H,
  Tint,
  VLine,
  WIDTH,
  rowY,
} from "./primitives";

/** Code widths used by the plain editor sketches. */
const CODE_WIDTHS = [48, 78, 36, 62] as const;

/** Four numbered code rows with the caret at the end of `cursorRow`. */
const CodeRows: React.FC<{
  cursorRow?: number;
  numbers?: readonly string[] | null;
  emphasizeCursorNumber?: boolean;
}> = ({ cursorRow, numbers = ["1", "2", "3", "4"], emphasizeCursorNumber }) => {
  const codeX = numbers ? CODE_X : 8;
  return (
    <>
      {CODE_WIDTHS.map((w, row) => (
        <React.Fragment key={row}>
          {numbers && (
            <LineNumber
              row={row}
              value={numbers[row]}
              className={
                emphasizeCursorNumber && row === cursorRow
                  ? "text-text-1"
                  : "text-text-3"
              }
            />
          )}
          <Bar x={codeX} row={row} w={w} />
        </React.Fragment>
      ))}
      {cursorRow != null && (
        <Caret x={codeX + CODE_WIDTHS[cursorRow] + 2} row={cursorRow} />
      )}
    </>
  );
};

// Lines 9–12 with the cursor on line 11 (row 2).
const LINE_NUMBER_ROWS: Record<EditorLineNumbers, readonly string[] | null> = {
  on: ["9", "10", "11", "12"],
  off: null,
  relative: ["2", "1", "11", "1"],
  interval: ["", "10", "", ""],
};

export const LineNumbersFigure: React.FC<{ mode: EditorLineNumbers }> = ({
  mode,
}) => (
  <Frame>
    <CodeRows
      cursorRow={2}
      numbers={LINE_NUMBER_ROWS[mode]}
      emphasizeCursorNumber
    />
  </Frame>
);

export const WordWrapFigure: React.FC<{ on: boolean }> = ({ on }) => (
  <Frame>
    <LineNumber row={0} value="1" />
    <Bar x={CODE_X} row={0} w={52} />
    <LineNumber row={1} value="2" />
    {/* Line 2 is longer than the pane: clipped at the edge when off,
        continued on an unnumbered row when on. */}
    <Bar x={CODE_X} row={1} w={on ? WIDTH - CODE_X - 8 : WIDTH} />
    {on ? (
      <>
        <Bar x={CODE_X} row={2} w={44} />
        <LineNumber row={3} value="3" />
        <Bar x={CODE_X} row={3} w={64} />
      </>
    ) : (
      <>
        <LineNumber row={2} value="3" />
        <Bar x={CODE_X} row={2} w={64} />
        <LineNumber row={3} value="4" />
        <Bar x={CODE_X} row={3} w={40} />
      </>
    )}
  </Frame>
);

export const HighlightActiveLineFigure: React.FC<{ on: boolean }> = ({
  on,
}) => (
  <Frame>
    {on && (
      <Tint
        x={3}
        row={1}
        w={WIDTH - 6}
        className="text-text-1"
        opacity={0.08}
      />
    )}
    <CodeRows cursorRow={1} emphasizeCursorNumber={on} />
  </Frame>
);

const MINIMAP_ROWS = [10, 14, 7, 12, 15, 9, 13, 6, 11, 14, 8, 12, 10, 13];

export const MinimapFigure: React.FC<{ on: boolean }> = ({ on }) => {
  const stripX = WIDTH - 22;
  return (
    <Frame>
      {[40, 70, 30, 56].map((w, row) => (
        <React.Fragment key={row}>
          <LineNumber row={row} value={String(row + 1)} />
          <Bar x={CODE_X} row={row} w={w} />
        </React.Fragment>
      ))}
      {on && (
        <>
          <VLine x={stripX - 3} />
          <rect
            x={stripX - 1}
            y={4}
            width={WIDTH - stripX - 3}
            height={18}
            rx={1.5}
            className="text-text-1"
            fill="currentColor"
            fillOpacity={0.08}
          />
          {MINIMAP_ROWS.map((w, i) => (
            <rect
              key={i}
              x={stripX}
              y={6 + i * 3.6}
              width={w}
              height={1.5}
              rx={0.75}
              className="text-text-4"
              fill="currentColor"
            />
          ))}
        </>
      )}
    </Frame>
  );
};

export const GitBlameFigure: React.FC<{ on: boolean }> = ({ on }) => {
  const cursorRow = 1;
  const blameX = CODE_X + CODE_WIDTHS[cursorRow] + 8;
  return (
    <Frame>
      <CodeRows cursorRow={cursorRow} />
      {on && (
        <>
          {/* Author avatar + "who, when · summary" annotation. */}
          <circle
            cx={blameX + 2.5}
            cy={rowY(cursorRow) + 5}
            r={2.5}
            className="text-text-3"
            fill="currentColor"
          />
          <Bar
            x={blameX + 7}
            row={cursorRow}
            w={WIDTH - blameX - 14}
            className="text-text-3"
            opacity={0.55}
          />
        </>
      )}
    </Frame>
  );
};

// ============================================
// Diff
// ============================================

/** Unchanged / changed / unchanged / unchanged rows in the split sketches. */
const DIFF_WIDTHS = [0.7, 0.9, 0.55, 0.8] as const;
const CHANGED_ROW = 1;
const SPLIT_GUTTER = 13;
const SPLIT_CODE_W = MID - 5 - 2 - SPLIT_GUTTER - 4;

const changeTint = (side: number) =>
  side === 0 ? "text-danger-6" : "text-success-6";

export const DiffViewModeFigure: React.FC<{ mode: DiffViewMode }> = ({
  mode,
}) =>
  mode === "unified" ? (
    <Frame>
      <LineNumber row={0} value="1" />
      <Bar x={CODE_X} row={0} w={56} />
      <Tint x={3} row={1} w={WIDTH - 6} className="text-danger-6" />
      <LineNumber row={1} value="2" />
      <Bar x={CODE_X} row={1} w={80} />
      <Tint x={3} row={2} w={WIDTH - 6} className="text-success-6" />
      <LineNumber row={2} value="2" />
      <Bar x={CODE_X} row={2} w={70} />
      <LineNumber row={3} value="3" />
      <Bar x={CODE_X} row={3} w={48} />
    </Frame>
  ) : (
    <Frame>
      <VLine x={MID} />
      {[5, MID + 3].map((paneX, side) =>
        DIFF_WIDTHS.map((w, row) => (
          <React.Fragment key={`${side}-${row}`}>
            {row === CHANGED_ROW && (
              <Tint
                x={paneX - 2}
                row={row}
                w={MID - 6}
                className={changeTint(side)}
              />
            )}
            <LineNumber
              row={row}
              value={String(row + 1)}
              x={paneX + SPLIT_GUTTER - 3}
            />
            <Bar x={paneX + SPLIT_GUTTER} row={row} w={SPLIT_CODE_W * w} />
          </React.Fragment>
        ))
      )}
    </Frame>
  );

/**
 * Split diff with the line-number gutters at each pane's left edge (off) or
 * both between the panes (on).
 */
export const SplitDiffLineNumbersFigure: React.FC<{ on: boolean }> = ({
  on,
}) => {
  const panes = on
    ? [
        { gutterX: MID - SPLIT_GUTTER - 1, codeX: 5 },
        { gutterX: MID + 1, codeX: MID + SPLIT_GUTTER + 4 },
      ]
    : [
        { gutterX: 5, codeX: 5 + SPLIT_GUTTER + 3 },
        { gutterX: MID + 3, codeX: MID + SPLIT_GUTTER + 6 },
      ];
  return (
    <Frame>
      <VLine x={MID} />
      {panes.map((pane, side) =>
        DIFF_WIDTHS.map((w, row) => (
          <React.Fragment key={`${side}-${row}`}>
            {row === CHANGED_ROW && (
              <Tint
                x={Math.min(pane.gutterX, pane.codeX) - 2}
                row={row}
                w={SPLIT_GUTTER + SPLIT_CODE_W + 7}
                className={changeTint(side)}
              />
            )}
            <LineNumber
              row={row}
              value={String(row + 1)}
              x={pane.gutterX + SPLIT_GUTTER - 3}
              className="text-primary-6"
            />
            <Bar x={pane.codeX} row={row} w={SPLIT_CODE_W * w} />
          </React.Fragment>
        ))
      )}
    </Frame>
  );
};

// ============================================
// File tree / Source Control
// ============================================

/** Folder, child file, child folder, grandchild file. */
const TREE_ROWS = [
  { depth: 0, w: 40 },
  { depth: 1, w: 52 },
  { depth: 1, w: 34 },
  { depth: 2, w: 46 },
] as const;
const TREE_INDENT = 10;
const TREE_X = 8;

const TreeRow: React.FC<{
  row: number;
  depth: number;
  w: number;
  className?: string;
}> = ({ row, depth, w, className }) => {
  const x = TREE_X + depth * TREE_INDENT;
  return (
    <>
      <rect
        x={x}
        y={rowY(row) + 2.5}
        width={5}
        height={5}
        rx={1}
        className="text-text-3"
        fill="currentColor"
      />
      <Bar x={x + 9} row={row} w={w} className={className} />
    </>
  );
};

const TREE_GUIDES = [
  { depth: 0, from: 1, to: 3 },
  { depth: 1, from: 3, to: 3 },
] as const;

export const TreeIndentGuidesFigure: React.FC<{ on: boolean }> = ({ on }) => (
  <Frame>
    {on &&
      TREE_GUIDES.map(({ depth, from, to }) => (
        <VLine
          key={depth}
          x={TREE_X + depth * TREE_INDENT + 2.5}
          y1={rowY(from)}
          y2={rowY(to) + ROW_H}
          opacity={1}
        />
      ))}
    {TREE_ROWS.map((r, row) => (
      <TreeRow key={row} row={row} depth={r.depth} w={r.w} />
    ))}
  </Frame>
);

/** Modified / added / unchanged / deleted file names. */
const STATUS_COLORS = [
  "text-warning-6",
  "text-success-6",
  "text-text-4",
  "text-danger-6",
] as const;

export const ColorFileNamesFigure: React.FC<{ on: boolean }> = ({ on }) => (
  <Frame>
    {[46, 58, 38, 50].map((w, row) => (
      <TreeRow
        key={row}
        row={row}
        depth={0}
        w={w}
        className={on ? STATUS_COLORS[row] : "text-text-4"}
      />
    ))}
  </Frame>
);

/** Preview figures for the chat composer and new chat page settings rows. */
import React from "react";

import type { CreatorComposerPosition } from "@src/config/sessionCreatorConfig";
import type { CreatorRepoChromePosition } from "@src/store/session/creatorRepoChromePositionAtom";

import { Area, Frame, MID, Outline, TextBar, WIDTH } from "./primitives";

// ============================================
// Composer
// ============================================

interface ComposerBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FULL_COMPOSER: ComposerBox = { x: 10, y: 20, w: WIDTH - 20, h: 30 };

/** + button, one or two model/effort pills, and the send button. */
const ComposerToolbar: React.FC<{
  box: ComposerBox;
  cy: number;
  separateEffort?: boolean;
  pills?: boolean;
}> = ({ box, cy, separateEffort = false, pills = true }) => (
  <>
    <circle
      cx={box.x + 8}
      cy={cy}
      r={3}
      className="text-text-3"
      fill="none"
      stroke="currentColor"
    />
    {pills &&
      (separateEffort ? (
        <>
          <Pill x={box.x + 15} cy={cy} w={28} barW={20} />
          <Pill x={box.x + 46} cy={cy} w={16} barW={9} />
        </>
      ) : (
        <>
          <Pill x={box.x + 15} cy={cy} w={42} barW={20} />
          <circle
            cx={box.x + 15 + 26}
            cy={cy}
            r={0.9}
            className="text-text-3"
            fill="currentColor"
          />
          <TextBar x={box.x + 15 + 29} y={cy - 1.5} w={9} />
        </>
      ))}
    <circle
      cx={box.x + box.w - 8}
      cy={cy}
      r={4}
      className="text-primary-6"
      fill="currentColor"
    />
  </>
);

/** A filled selector pill with a text bar inside. */
const Pill: React.FC<{ x: number; cy: number; w: number; barW: number }> = ({
  x,
  cy,
  w,
  barW,
}) => (
  <>
    <Area
      x={x}
      y={cy - 4}
      w={w}
      h={8}
      rx={4}
      className="text-text-4"
      opacity={0.3}
    />
    <TextBar x={x + 4} y={cy - 1.5} w={barW} className="text-text-3" />
  </>
);

/** Full-size stacked composer: text area above the toolbar row. */
const StackedComposer: React.FC<{
  box?: ComposerBox;
  separateEffort?: boolean;
  pills?: boolean;
}> = ({ box = FULL_COMPOSER, separateEffort, pills }) => (
  <>
    <Outline x={box.x} y={box.y} w={box.w} h={box.h} rx={6} />
    <TextBar x={box.x + 7} y={box.y + 6} w={46} opacity={0.7} />
    <ComposerToolbar
      box={box}
      cy={box.y + box.h - 8}
      separateEffort={separateEffort}
      pills={pills}
    />
  </>
);

/** One-row capsule: +, placeholder, send. */
const CompactComposer: React.FC<{ box: ComposerBox }> = ({ box }) => {
  const cy = box.y + box.h / 2;
  return (
    <>
      <Outline x={box.x} y={box.y} w={box.w} h={box.h} rx={box.h / 2} />
      <TextBar x={box.x + 16} y={cy - 1.5} w={46} opacity={0.7} />
      <ComposerToolbar box={box} cy={cy} pills={false} />
    </>
  );
};

export const PinnedSkillsFigure: React.FC<{ on: boolean }> = ({ on }) => (
  <Frame>
    {on &&
      [24, 30, 20].map((w, i, widths) => {
        const x = 10 + widths.slice(0, i).reduce((sum, n) => sum + n + 3, 0);
        return (
          <React.Fragment key={i}>
            <Outline x={x} y={8} w={w} h={8} rx={4} />
            <TextBar x={x + 4} y={10.5} w={w - 8} className="text-text-3" />
          </React.Fragment>
        );
      })}
    <StackedComposer />
  </Frame>
);

export const CompactInputFigure: React.FC<{ on: boolean }> = ({ on }) => (
  <Frame>
    {on ? (
      <CompactComposer box={{ x: 10, y: 34, w: WIDTH - 20, h: 16 }} />
    ) : (
      <StackedComposer />
    )}
  </Frame>
);

export const ComposerGlowFigure: React.FC<{ on: boolean }> = ({ on }) => {
  const box = { x: 10, y: 10, w: WIDTH - 20, h: 30 };
  return (
    <Frame>
      {on &&
        // Stacked ellipses stand in for the radial primary aura that sits
        // under the composer's bottom edge.
        [
          { rx: 54, ry: 18, opacity: 0.12 },
          { rx: 40, ry: 12, opacity: 0.18 },
          { rx: 24, ry: 7, opacity: 0.26 },
        ].map((glow) => (
          <ellipse
            key={glow.rx}
            cx={MID}
            cy={box.y + box.h}
            rx={glow.rx}
            ry={glow.ry}
            className="text-primary-6"
            fill="currentColor"
            fillOpacity={glow.opacity}
          />
        ))}
      <Area
        x={box.x}
        y={box.y}
        w={box.w}
        h={box.h}
        rx={6}
        className="text-bg-2"
        opacity={1}
      />
      <StackedComposer box={box} />
    </Frame>
  );
};

export const SeparateEffortFigure: React.FC<{ on: boolean }> = ({ on }) => (
  <Frame>
    <StackedComposer
      box={{ x: 10, y: 12, w: WIDTH - 20, h: 38 }}
      separateEffort={on}
    />
  </Frame>
);

// ============================================
// New chat page
// ============================================

/** Greeting stand-in above the composer on the new chat page. */
const Greeting: React.FC<{ y: number }> = ({ y }) => (
  <TextBar x={MID - 22} y={y} w={44} className="text-text-3" />
);

export const InputPositionFigure: React.FC<{
  position: CreatorComposerPosition;
}> = ({ position }) => {
  const middle = position === "middle";
  const box = { x: 14, y: middle ? 26 : 42, w: WIDTH - 28, h: 14 };
  return (
    <Frame>
      <Greeting y={middle ? 16 : 22} />
      <CompactComposer box={box} />
    </Frame>
  );
};

/** Folder + branch chips of the repo bar. */
const RepoBar: React.FC<{ y: number }> = ({ y }) => (
  <>
    {[
      { x: 14, w: 28 },
      { x: 45, w: 24 },
    ].map(({ x, w }) => (
      <React.Fragment key={x}>
        <Area
          x={x}
          y={y}
          w={w}
          h={8}
          rx={4}
          className="text-primary-6"
          opacity={0.14}
        />
        <TextBar x={x + 4} y={y + 2.5} w={w - 8} className="text-primary-6" />
      </React.Fragment>
    ))}
  </>
);

export const RepoBarPositionFigure: React.FC<{
  position: CreatorRepoChromePosition;
}> = ({ position }) => {
  const box = { x: 10, y: 21, w: WIDTH - 20, h: 20 };
  return (
    <Frame>
      <RepoBar y={position === "top" ? 9 : 45} />
      <Outline x={box.x} y={box.y} w={box.w} h={box.h} rx={6} />
      <TextBar x={box.x + 7} y={box.y + 5} w={46} opacity={0.7} />
      <ComposerToolbar box={box} cy={box.y + box.h - 6} pills={false} />
    </Frame>
  );
};

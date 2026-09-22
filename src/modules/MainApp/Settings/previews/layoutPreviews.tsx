/** Preview figures for the app Layout settings rows. */
import React from "react";

import {
  CHAT_SPLIT_RATIOS,
  type ChatSplitRatio,
} from "@src/engines/ChatPanel/config";
import type { ModelPickerStyle } from "@src/store/ui/chatPanel/displayPrefsAtoms";
import type { ChatPanelPosition } from "@src/store/ui/workStationLayout/chatPositionAtoms";
import type { LayoutMode } from "@src/store/ui/workStationLayout/splitLayoutAtoms";

import {
  Area,
  Frame,
  HEIGHT,
  MID,
  Outline,
  TextBar,
  VLine,
  WIDTH,
} from "./primitives";

const CHAT_W = 44;
const SIDEBAR_W = 24;
const EMPHASIS = "text-primary-6";

/** Chat column: a few message bubbles. */
const ChatColumn: React.FC<{ x: number }> = ({ x }) => (
  <>
    <Area
      x={x + 2}
      y={2}
      w={CHAT_W - 4}
      h={HEIGHT - 4}
      rx={3}
      className={EMPHASIS}
      opacity={0.1}
    />
    <TextBar x={x + 16} y={9} w={CHAT_W - 22} className="text-text-3" />
    <TextBar x={x + 6} y={17} w={CHAT_W - 16} />
    <TextBar x={x + 6} y={23} w={CHAT_W - 22} />
    <TextBar x={x + 16} y={33} w={CHAT_W - 24} className="text-text-3" />
    <TextBar x={x + 6} y={41} w={CHAT_W - 18} />
  </>
);

/** Workstation sidebar: a quiet, evenly spaced list. */
const SidebarColumn: React.FC<{ x: number }> = ({ x }) => (
  <>
    <Area
      x={x + 2}
      y={2}
      w={SIDEBAR_W - 4}
      h={HEIGHT - 4}
      rx={3}
      className={EMPHASIS}
      opacity={0.08}
    />
    {[12, 9, 14, 8, 11, 10].map((w, i) => (
      <TextBar
        key={i}
        x={x + 6}
        y={8 + i * 7}
        w={w}
        className="text-text-4"
        opacity={0.8}
      />
    ))}
  </>
);

/** Editor: plain code rows. */
const EditorColumn: React.FC<{ x: number; w: number }> = ({ x, w }) => (
  <>
    {[0.6, 0.85, 0.45, 0.7, 0.55].map((ratio, i) => (
      <TextBar key={i} x={x + 5} y={8 + i * 7} w={(w - 10) * ratio} />
    ))}
  </>
);

export const ChatPanelPositionFigure: React.FC<{
  position: ChatPanelPosition;
}> = ({ position }) => {
  const chatX = position === "left" ? 0 : WIDTH - CHAT_W;
  return (
    <Frame>
      <ChatColumn x={chatX} />
      <VLine
        x={position === "left" ? CHAT_W : WIDTH - CHAT_W}
        y1={1}
        y2={HEIGHT - 1}
      />
      <EditorColumn x={position === "left" ? CHAT_W : 0} w={WIDTH - CHAT_W} />
    </Frame>
  );
};

/**
 * The split preset, drawn at the chosen ratio: the chat pane on the left (the
 * default side) and the station's editor rows filling the rest.
 */
export const ChatSplitRatioFigure: React.FC<{ ratio: ChatSplitRatio }> = ({
  ratio,
}) => {
  const chatW = Math.round(WIDTH * CHAT_SPLIT_RATIOS[ratio]);
  return (
    <Frame>
      <Area
        x={2}
        y={2}
        w={chatW - 4}
        h={HEIGHT - 4}
        rx={3}
        className={EMPHASIS}
        opacity={0.1}
      />
      <TextBar x={chatW - 26} y={13} w={20} className="text-text-3" />
      <TextBar x={6} y={23} w={chatW - 16} />
      <TextBar x={6} y={29} w={chatW - 24} />
      <TextBar x={chatW - 30} y={39} w={24} className="text-text-3" />
      <VLine x={chatW} y1={1} y2={HEIGHT - 1} />
      <EditorColumn x={chatW} w={WIDTH - chatW} />
    </Frame>
  );
};

export const SidebarPositionFigure: React.FC<{ position: LayoutMode }> = ({
  position,
}) => {
  const sidebarX = position === "left" ? 0 : WIDTH - SIDEBAR_W;
  return (
    <Frame>
      <SidebarColumn x={sidebarX} />
      <VLine
        x={position === "left" ? SIDEBAR_W : WIDTH - SIDEBAR_W}
        y1={1}
        y2={HEIGHT - 1}
        opacity={0.3}
      />
      <EditorColumn
        x={position === "left" ? SIDEBAR_W : 0}
        w={WIDTH - SIDEBAR_W}
      />
    </Frame>
  );
};

/** Picker rows; the second is the highlighted choice. */
const PickerRows: React.FC<{ x: number; y: number; w: number }> = ({
  x,
  y,
  w,
}) => (
  <>
    {[0.55, 0.7, 0.45].map((ratio, i) => (
      <React.Fragment key={i}>
        {i === 1 && (
          <Area
            x={x + 2}
            y={y + i * 7 - 2}
            w={w - 4}
            h={7}
            className="text-text-1"
            opacity={0.08}
          />
        )}
        <circle
          cx={x + 6}
          cy={y + i * 7 + 1.5}
          r={1.8}
          className="text-text-3"
          fill="currentColor"
        />
        <TextBar x={x + 10} y={y + i * 7} w={(w - 14) * ratio} />
      </React.Fragment>
    ))}
  </>
);

export const ModelPickerStyleFigure: React.FC<{ style: ModelPickerStyle }> = ({
  style,
}) => {
  const composer = { x: 12, y: HEIGHT - 16, w: WIDTH - 24, h: 11 };
  const pillX = composer.x + 12;
  return (
    <Frame>
      <Outline
        x={composer.x}
        y={composer.y}
        w={composer.w}
        h={composer.h}
        rx={5.5}
      />
      <Area
        x={pillX}
        y={composer.y + 2.5}
        w={22}
        h={6}
        rx={3}
        className={EMPHASIS}
        opacity={0.3}
      />
      {style === "spotlight" ? (
        // Centered palette with its own search field.
        <>
          <Area
            x={MID - 38}
            y={4}
            w={76}
            h={37}
            rx={4}
            className="text-bg-2"
            opacity={1}
          />
          <Outline x={MID - 38} y={4} w={76} h={37} rx={4} />
          <TextBar x={MID - 32} y={9} w={30} className="text-text-3" />
          <line
            x1={MID - 37}
            y1={16}
            x2={MID + 37}
            y2={16}
            className="text-text-4"
            stroke="currentColor"
            strokeOpacity={0.5}
          />
          <PickerRows x={MID - 38} y={21} w={76} />
        </>
      ) : (
        // Menu anchored to the model pill.
        <>
          <Area
            x={pillX - 2}
            y={15}
            w={50}
            h={25}
            rx={4}
            className="text-bg-2"
            opacity={1}
          />
          <Outline x={pillX - 2} y={15} w={50} h={25} rx={4} />
          <PickerRows x={pillX - 2} y={20} w={50} />
        </>
      )}
    </Frame>
  );
};

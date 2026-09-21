import { describe, expect, it } from "vitest";

import { getCodeBlockBodyStyle } from "../codeBlockBodyStyle";
import { STYLE_CONFIG } from "../config";

const base = {
  contentHeight: 124,
  isCollapsed: false,
  isExpanded: false,
  isLoading: false,
  needsExpand: false,
  useTerminalLayout: false,
};
const transition = `opacity ${STYLE_CONFIG.animationDuration}ms ease-out`;

describe("getCodeBlockBodyStyle", () => {
  it("leaves the terminal layout unstyled, even while streaming", () => {
    expect(
      getCodeBlockBodyStyle({ ...base, useTerminalLayout: true })
    ).toBeUndefined();
    expect(
      getCodeBlockBodyStyle({
        ...base,
        useTerminalLayout: true,
        isLoading: true,
      })
    ).toBeUndefined();
  });

  it("caps the streaming window by visible lines, defaulting to 15", () => {
    expect(getCodeBlockBodyStyle({ ...base, isLoading: true })).toEqual({
      maxHeight: 15 * 18 + 16,
      overflowY: "auto",
      overflowX: "hidden",
      transition,
    });
    expect(
      getCodeBlockBodyStyle({ ...base, isLoading: true, visibleLines: 4 })
    ).toMatchObject({ maxHeight: 4 * 18 + 16 });
  });

  it("clamps a truncated preview to the content height", () => {
    expect(getCodeBlockBodyStyle({ ...base, needsExpand: true })).toEqual({
      opacity: 1,
      overflow: "hidden",
      maxHeight: 124,
      overflowY: undefined,
      overflowX: undefined,
      transition,
    });
  });

  it("scrolls an expanded long block inside 40vh", () => {
    expect(
      getCodeBlockBodyStyle({ ...base, needsExpand: true, isExpanded: true })
    ).toEqual({
      opacity: 1,
      overflow: undefined,
      maxHeight: "40vh",
      overflowY: "auto",
      overflowX: "hidden",
      transition,
    });
  });

  it("does not cap a block that fits", () => {
    expect(
      getCodeBlockBodyStyle({ ...base, isExpanded: true, isCollapsed: true })
    ).toEqual({
      opacity: 0,
      overflow: "hidden",
      maxHeight: undefined,
      overflowY: undefined,
      overflowX: undefined,
      transition,
    });
  });
});

import { describe, expect, it } from "vitest";

import { findStickyIndex } from "./usePickerVirtualization";

describe("picker sticky section selection", () => {
  it("keeps the current section until the next title reaches the viewport", () => {
    const headers = [0, 12, 45];
    expect(findStickyIndex(headers, 0)).toBe(0);
    expect(findStickyIndex(headers, 11)).toBe(0);
    expect(findStickyIndex(headers, 12)).toBe(12);
    expect(findStickyIndex(headers, 44)).toBe(12);
    expect(findStickyIndex(headers, 45)).toBe(45);
    expect(findStickyIndex(headers, 1000)).toBe(45);
    expect(findStickyIndex(headers, 3)).toBe(0);
  });

  it("does not pin a future title or retain one after headers disappear", () => {
    expect(findStickyIndex([5, 20], 4)).toBe(-1);
    expect(findStickyIndex([5, 20], 5)).toBe(5);
    expect(findStickyIndex([], 20)).toBe(-1);
  });
});

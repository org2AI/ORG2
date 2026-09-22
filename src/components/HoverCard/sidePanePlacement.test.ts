import { describe, expect, it } from "vitest";

import { getSidePanePlacement } from "./sidePanePlacement";

const anchor = { left: 100, right: 700, top: 100, bottom: 500 };
const size = { width: 320, height: 220 };

describe("secondary pane placement", () => {
  it("clears the parent panel on the right in wide windows", () => {
    expect(
      getSidePanePlacement(anchor, size, { width: 1200, height: 800 })
    ).toMatchObject({ top: 100, left: 708 });
  });
  it("centers below the panel when the right side cannot fit", () => {
    expect(
      getSidePanePlacement(anchor, size, { width: 800, height: 800 })
    ).toMatchObject({ top: 508, left: 240, maxHeight: 284 });
  });
  it("clears the 36px footer with the same 8px gap while side placement follows the row", () => {
    const row = { left: 108, right: 692, top: 200, bottom: 232 };
    const shell = { left: 100, right: 700, bottom: 500 + 8 + 36 };
    expect(
      getSidePanePlacement(row, size, { width: 800, height: 900 }, shell)
    ).toMatchObject({ top: 552, left: 240 });
    expect(
      getSidePanePlacement(row, size, { width: 1200, height: 900 }, shell)
    ).toMatchObject({ top: 200, left: 708 });
  });
  it("keeps a scrollable pane visible in very small windows", () => {
    const result = getSidePanePlacement(anchor, size, {
      width: 280,
      height: 640,
    });
    expect(result.left).toBe(8);
    expect(result.maxWidth).toBe(264);
    expect(result.maxHeight).toBe(124);
    expect(result.top + result.maxHeight).toBe(632);
  });
});

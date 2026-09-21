import { describe, expect, it } from "vitest";

import { resolveWorkbenchTouchesLeadingEdge } from "./workbenchLeadingEdgeContext";

describe("resolveWorkbenchTouchesLeadingEdge", () => {
  it("is false while the Settings slot sits left, whatever the saved chat side", () => {
    // AppLayout pins Settings left and always shows it, even when the saved
    // chat preference is "right" with a 0 width — the case the old raw-atom
    // check got wrong.
    expect(
      resolveWorkbenchTouchesLeadingEdge({
        chatSlotMaximized: false,
        chatSlotVisible: true,
        chatSlotOnLeft: true,
      })
    ).toBe(false);
  });

  it("is false while the chat slot is maximized over the workbench", () => {
    expect(
      resolveWorkbenchTouchesLeadingEdge({
        chatSlotMaximized: true,
        chatSlotVisible: true,
        chatSlotOnLeft: false,
      })
    ).toBe(false);
  });

  it("is true with the chat on the right or hidden", () => {
    expect(
      resolveWorkbenchTouchesLeadingEdge({
        chatSlotMaximized: false,
        chatSlotVisible: true,
        chatSlotOnLeft: false,
      })
    ).toBe(true);
    expect(
      resolveWorkbenchTouchesLeadingEdge({
        chatSlotMaximized: false,
        chatSlotVisible: false,
        chatSlotOnLeft: true,
      })
    ).toBe(true);
  });
});

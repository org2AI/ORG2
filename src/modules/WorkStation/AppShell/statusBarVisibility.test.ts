import { describe, expect, it } from "vitest";

import { shouldShowWorkStationStatusBar } from "./statusBarVisibility";

describe("shouldShowWorkStationStatusBar", () => {
  it("hides the status bar for My Station chat session tabs", () => {
    expect(
      shouldShowWorkStationStatusBar({
        isAgentStation: false,
        activeTabType: "chat-session",
      })
    ).toBe(false);
  });

  it("keeps the status bar for ordinary My Station tabs", () => {
    expect(
      shouldShowWorkStationStatusBar({
        isAgentStation: false,
        activeTabType: "file",
      })
    ).toBe(true);
  });

  it("hides the status bar in Agent Station", () => {
    expect(
      shouldShowWorkStationStatusBar({
        isAgentStation: true,
        activeTabType: "file",
      })
    ).toBe(false);
  });
});

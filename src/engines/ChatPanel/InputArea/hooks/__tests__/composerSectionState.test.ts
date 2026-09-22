import { describe, expect, it } from "vitest";

import { resolveComposerSectionForSessionSwitch } from "../composerSectionState";

describe("resolveComposerSectionForSessionSwitch", () => {
  it("opens no section when returning to a session with no stored preference", () => {
    expect(
      resolveComposerSectionForSessionSwitch({
        previousSessionId: "session-b",
        nextSessionId: "session-a",
        currentActiveSection: "process",
      }).activeSection
    ).toBeNull();
  });

  it("restores the section stored for the session being returned to", () => {
    expect(
      resolveComposerSectionForSessionSwitch({
        previousSessionId: "session-b",
        nextSessionId: "session-a",
        currentActiveSection: null,
        previouslyStoredSection: "process",
      }).activeSection
    ).toBe("process");
  });

  it("stores the previous session section before switching away", () => {
    expect(
      resolveComposerSectionForSessionSwitch({
        previousSessionId: "session-a",
        nextSessionId: "session-b",
        currentActiveSection: "process",
      }).storedSectionForPrevious
    ).toBe("process");
  });
});

// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TurnSummary } from "@src/engines/SessionCore/storage/sqliteCache";
import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";

import TurnMetadataFooter from "..";

vi.mock("@src/components/FileTypeIcon", () => ({
  default: () => React.createElement("span"),
}));

const PR_URL = "https://github.com/org2AI/ORG2/pull/851";

const SUMMARY: TurnSummary = {
  sessionId: "session-1",
  turnId: "turn-1",
  startSequence: 1,
  endSequence: 2,
  nextTurnId: null,
  startedAt: "2026-08-21T00:00:00.000Z",
  endedAt: "2026-08-21T00:00:01.000Z",
  durationMs: 1000,
  userEventIds: [],
  userPreview: "",
  eventCount: 1,
  bodyEventCount: 1,
  status: "completed",
  interrupted: false,
  modifiedFiles: [],
  resourceInteractions: [],
  gitArtifacts: [
    {
      kind: "pullRequest",
      url: PR_URL,
      prNumber: 851,
      prTitle: "feat: worktree source modal",
    },
  ],
};

describe("TurnMetadataFooter PR row", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the PR in the workstation Browser and brings it into view", async () => {
    const events: CustomEvent<{ url: string; navigate?: boolean }>[] = [];
    window.addEventListener("open-url-in-browser", (event) => {
      events.push(event as CustomEvent<{ url: string; navigate?: boolean }>);
    });

    const root = createSmokeRoot();
    await root.render(
      React.createElement(TurnMetadataFooter, {
        summary: SUMMARY,
        sessionId: SUMMARY.sessionId,
        turnId: SUMMARY.turnId,
      })
    );

    const row = root.container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-metadata-pr"]'
    );
    expect(row).not.toBeNull();
    expect(row?.disabled).toBe(false);
    expect(row?.querySelector('[data-icon="chrome"]')).not.toBeNull();
    expect(
      row?.querySelector('[data-icon="square-arrow-out-up-right"]')
    ).toBeNull();

    await dispatch(() => row?.click());

    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ url: PR_URL, navigate: true });

    await root.unmount();
  });
});

describe("TurnMetadataFooter container disclosure", () => {
  it("collapses and reopens the body while keeping tabs and counts available", async () => {
    const root = createSmokeRoot();
    await root.render(
      React.createElement(TurnMetadataFooter, {
        summary: SUMMARY,
        sessionId: SUMMARY.sessionId,
        turnId: SUMMARY.turnId,
      })
    );
    const toggle = root.container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-metadata-collapse-toggle"]'
    )!;
    const tab = root.container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-metadata-edits-tab"]'
    )!;
    expect(toggle).not.toBeNull();
    expect(tab.className).toContain("bg-transparent");
    expect(tab.querySelector(".rounded-full")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      root.container.querySelector('[data-testid="turn-metadata-pr"]')
    ).not.toBeNull();

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await dispatch(() => toggle.click());
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(
        root.container.querySelector(
          '[data-testid="turn-metadata-scroll-area"]'
        )
      ).toBeNull();
      expect(root.container.contains(tab)).toBe(true);
      expect(
        root.container.querySelector(
          '[data-testid="turn-metadata-edits-count"]'
        )?.textContent
      ).toBe("1");

      await dispatch(() => toggle.click());
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(
        root.container.querySelector('[data-testid="turn-metadata-pr"]')
      ).not.toBeNull();
      expect(
        document.getElementById(toggle.getAttribute("aria-controls")!)
      ).not.toBeNull();
    }
    await root.unmount();
  });
});

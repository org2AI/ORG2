// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { makeSessionEvent } from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";

import WaitActivityGroup, { buildWaitGroupSummary } from ".";
import { buildActivityGroupItems } from "../activityGroupProjection";

vi.mock("@src/engines/ChatPanel/hooks/useChatEventReplay", () => ({
  useChatEventReplay: () => ({
    replayEventById: vi.fn(),
    canReplay: false,
  }),
}));

vi.mock("@src/engines/SessionCore/rendering/registry/events", () => ({
  getChatLazyComponent: () => () => createElement("div", null, "Wait row"),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key === "tools.waitSummary.count" ? `${opts?.count} times` : key,
  }),
}));

const translate = (key: string, opts?: Record<string, unknown>) =>
  key === "tools.waitSummary.count" ? `${opts?.count} times` : key;

/** A Codex Desktop poll the importer could not merge into its command. */
function makePoll(
  wallSeconds: number,
  overrides: Partial<SessionEvent> = {}
): SessionEvent {
  return makeSessionEvent({
    action_type: "tool_call",
    function: "await_output",
    uiCanonical: "await_output",
    args: {
      command: "wait_for",
      handle: "10689",
      handles: ["10689"],
      session_id: "10689",
      chars: "",
      block_until_ms: 1000,
    },
    result: {
      success: true,
      status: "completed",
      output: `Script completed\nWall time ${wallSeconds.toFixed(1)} seconds\nOutput:\n`,
    },
    ...overrides,
  });
}

function makeOrg2Wait(): SessionEvent {
  return makeSessionEvent({
    action_type: "tool_call",
    function: "await_output",
    uiCanonical: "await_output",
    args: { command: "wait_for", handles: ["48291"], block_until_ms: 600000 },
    result: {
      output: `awaitMeta::${JSON.stringify({
        count: 1,
        items: [{ handle: "48291", jobKind: "shell", status: "succeeded" }],
      })}`,
    },
  });
}

describe("buildWaitGroupSummary", () => {
  it("reports how many waits ran and the total time waited", () => {
    const items = buildActivityGroupItems([
      makePoll(5),
      makePoll(40),
      makePoll(27),
    ]);

    expect(buildWaitGroupSummary(items, translate)).toBe("3 times · 1m 12s");
  });

  it("counts every wait but totals only the finished ones", () => {
    const items = buildActivityGroupItems([
      makePoll(4),
      makePoll(9, { displayStatus: "failed" }),
      makePoll(0, { displayStatus: "running", result: {} }),
    ]);

    expect(buildWaitGroupSummary(items, translate)).toBe("3 times · 4s");
  });

  it("omits the duration when no wait recorded one", () => {
    const items = buildActivityGroupItems([makeOrg2Wait(), makeOrg2Wait()]);

    expect(buildWaitGroupSummary(items, translate)).toBe("2 times");
  });
});

describe("WaitActivityGroup", () => {
  it("renders a closed run collapsed behind its label and summary", () => {
    const markup = renderToStaticMarkup(
      createElement(WaitActivityGroup, {
        events: [makePoll(5), makePoll(1)],
        closedByBoundary: true,
      })
    );

    expect(markup).toContain("tools.waitBackgroundTasks");
    expect(markup).toContain("2 times · 6s");
    expect(markup).toContain('data-tool-call-name="await_output"');
    expect(markup).not.toContain("Wait row");
  });

  it("keeps a live run open and collapses it when the run closes", () => {
    const events = [makePoll(5), makePoll(1)];
    const container = document.createElement("div");
    const root = createRoot(container);
    const environment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      act(() =>
        root.render(
          createElement(WaitActivityGroup, { events, closedByBoundary: false })
        )
      );
      expect(container.textContent).toContain("Wait row");

      act(() =>
        root.render(
          createElement(WaitActivityGroup, { events, closedByBoundary: true })
        )
      );
      expect(container.textContent).not.toContain("Wait row");
      expect(container.textContent).toContain("2 times · 6s");
    } finally {
      act(() => root.unmount());
      environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });
});

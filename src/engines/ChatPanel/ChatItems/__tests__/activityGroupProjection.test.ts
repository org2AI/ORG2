import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { makeSessionEvent } from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";

import {
  buildActivityGroupItems,
  markActivityGroupTail,
  renderActivityGroupEvent,
  suppressLoadingForNonLastRunningEvent,
} from "../activityGroupProjection";

vi.mock("@src/engines/SessionCore/rendering/registry/events", () => ({
  getChatLazyComponent:
    () =>
    ({ event }: { event: { id: string; displayStatus: string } }) =>
      createElement(
        "div",
        { "data-event": event.id, "data-status": event.displayStatus },
        event.id
      ),
}));

describe("activity group projection", () => {
  it("marks only the final event as the live group tail", () => {
    const first = makeSessionEvent();
    const second = makeSessionEvent();

    expect(buildActivityGroupItems([first, second])).toEqual([
      { event: first, isLastItem: false },
      { event: second, isLastItem: true },
    ]);
    expect(buildActivityGroupItems([])).toEqual([]);
  });

  it("keeps per-item data while tagging the tail of pre-shaped items", () => {
    const first = makeSessionEvent();
    const second = makeSessionEvent();

    expect(
      markActivityGroupTail([
        { category: "read", event: first },
        { category: "search", event: second },
      ])
    ).toEqual([
      { category: "read", event: first, isLastItem: false },
      { category: "search", event: second, isLastItem: true },
    ]);
  });

  it("suppresses a stale running state only before the live tail", () => {
    const running = makeSessionEvent({
      displayStatus: "running",
      activityStatus: "agent",
      isDelta: true,
    });

    expect(suppressLoadingForNonLastRunningEvent(running, true)).toBe(running);
    expect(suppressLoadingForNonLastRunningEvent(running, false)).toMatchObject(
      {
        displayStatus: "completed",
        activityStatus: "processed",
        isDelta: false,
      }
    );
  });

  it("leaves non-running events untouched regardless of position", () => {
    const completed = makeSessionEvent({ displayStatus: "completed" });
    const failed = makeSessionEvent({ displayStatus: "failed" });

    expect(suppressLoadingForNonLastRunningEvent(completed, false)).toBe(
      completed
    );
    expect(suppressLoadingForNonLastRunningEvent(failed, false)).toBe(failed);
  });

  it("renders each item through the registry with the projected status", () => {
    const [first, second] = buildActivityGroupItems([
      makeSessionEvent({ id: "evt-1", displayStatus: "running" }),
      makeSessionEvent({ id: "evt-2", displayStatus: "running" }),
    ]);

    const before = renderToStaticMarkup(
      createElement("div", null, renderActivityGroupEvent(first))
    );
    const tail = renderToStaticMarkup(
      createElement("div", null, renderActivityGroupEvent(second))
    );

    expect(before).toContain('data-event="evt-1"');
    expect(before).toContain('data-status="completed"');
    expect(tail).toContain('data-event="evt-2"');
    expect(tail).toContain('data-status="running"');
  });
});

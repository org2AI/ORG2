// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import ActivitySimulatorGrid from "../ActivitySimulatorGrid";
import type { GridCellProps } from "../types/gridTypes";

const observed = vi.hoisted(() => ({
  mounted: [] as string[],
  unmounted: [] as string[],
}));
vi.mock("@src/engines/SessionCore", async () => {
  const { atom } = await import("jotai");
  return { replayModeAtom: atom("follow") };
});
vi.mock("../components/GridCell", () => ({
  IndependentGridCell: function Cell(props: GridCellProps) {
    const mountedSessionId = useRef(props.sessionId).current;
    useEffect(() => {
      observed.mounted.push(mountedSessionId);
      return () => {
        observed.unmounted.push(mountedSessionId);
      };
    }, [mountedSessionId]);
    return React.createElement(
      "span",
      null,
      `${props.sessionId}/${props.threadId}`
    );
  },
  SimpleGridCell: () => null,
}));
vi.mock("../components/MultiTaskHeader", () => ({
  MultiTaskHeader: () => null,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("remounts a named-thread owner on a session switch even with identical data props", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const store = createStore();
  const shared = {
    layout: "1x2" as const,
    events: [],
    taskThreads: [{ threadId: "review", eventCount: 0 }],
  };
  const render = (sessionId: string) =>
    act(() =>
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(ActivitySimulatorGrid, { ...shared, sessionId })
        )
      )
    );
  try {
    render("session-a");
    expect(container.textContent).toContain("session-a/review");
    render("session-b");
    expect(container.textContent).toContain("session-b/review");
    expect(observed.mounted).toEqual(["session-a", "session-b"]);
    expect(observed.unmounted).toEqual(["session-a"]);
  } finally {
    act(() => root.unmount());
  }
  expect(observed.unmounted).toEqual(["session-a", "session-b"]);
});

// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import PlanningIndicatorBridge from "../PlanningIndicatorBridge";

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("@src/engines/SessionCore", () => ({
  useStreamingDeltaForSession: () => null,
}));
vi.mock("@src/engines/ChatPanel/hooks/useAgentStatusTrail", () => ({
  useAgentStatusTrail: () => ({ phase: "hidden" }),
}));
vi.mock("@src/engines/ChatPanel/hooks/useManualCompact", async () => {
  const { atom } = await import("jotai");
  return { manualCompactInFlightSessionAtom: atom(null) };
});
vi.mock("@src/engines/SessionCore/hooks/replay/usePlanningIndicator", () => ({
  usePlanningIndicator: () => ({ count: 1, variantIndex: 7 }),
}));
vi.mock("../ChatHistoryList", () => ({
  default: function MockHistoryList({
    planningIndicatorCount,
  }: {
    planningIndicatorCount: number;
  }) {
    useEffect(() => {
      lifecycle.mounts++;
      return () => {
        lifecycle.unmounts++;
      };
    }, []);
    return createElement(
      "div",
      { "data-testid": "scroll-root" },
      planningIndicatorCount
    );
  },
}));

it("preserves the history scroll root across runner start, Stop and runtime changes", () => {
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  lifecycle.mounts = 0;
  lifecycle.unmounts = 0;
  const container = document.createElement("div");
  const root = createRoot(container);
  // List props are deliberately stubbed: this tests the production bridge's
  // ownership of the list, not the virtualizer's geometry implementation.
  const noop = () => undefined;
  const props: Omit<
    Parameters<typeof PlanningIndicatorBridge>[0],
    "planningIndicatorScope"
  > = {
    flatItems: [],
    groupCounts: [],
    turnIds: [],
    totalFlatItems: 0,
    codeBlockContainerWidth: 800,
    footerSpacerHeight: 0,
    bottomInset: 0,
    topPaddingPx: 0,
    virtualListRef: { current: null },
    virtualListDataKey: "same-conversation",
    getIsWpGeneWorking: () => false,
    getIsExploring: () => false,
    renderGroupHeader: () => null,
    onAtBottomStateChange: noop,
    onRangeChanged: noop,
    onEndReached: noop,
    onSubmit: noop,
    onSkip: noop,
    virtualScrollerRef: { current: null },
    planningIndicatorEnabled: true,
    onPlanningIndicatorCount: vi.fn(),
    tailTurnStartedAtMs: null,
    tailTurnLastActivityAtMs: null,
  };
  try {
    act(() =>
      root.render(
        createElement(PlanningIndicatorBridge, {
          ...props,
          planningIndicatorScope: null,
        })
      )
    );
    const scrollRoot = container.firstElementChild as HTMLElement;
    scrollRoot.scrollTop = 3200;
    for (const scope of [
      { sessionId: "codex-child", isLive: true },
      null,
      { sessionId: "claude-child", isLive: true },
      null,
    ]) {
      act(() =>
        root.render(
          createElement(PlanningIndicatorBridge, {
            ...props,
            planningIndicatorScope: scope,
          })
        )
      );
      expect(container.querySelector('[data-testid="scroll-root"]')).toBe(
        scrollRoot
      );
      expect(scrollRoot.scrollTop).toBe(3200);
      expect(scrollRoot.textContent).toBe(scope ? "1" : "0");
    }
    expect(lifecycle.mounts).toBe(1);
    expect(lifecycle.unmounts).toBe(0);
  } finally {
    act(() => root.unmount());
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  }
});

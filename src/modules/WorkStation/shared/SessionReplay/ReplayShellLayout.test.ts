// @vitest-environment jsdom
import React, { act, createElement as h, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReplayShellLayout,
  type ReplayShellLayoutProps,
} from "./ReplayShellLayout";

const mocks = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("@src/engines/ChatPanel/adapters/EventWrapper", () => ({
  default: ({ children, mode }: React.PropsWithChildren<{ mode: string }>) =>
    h("section", { "data-event-mode": mode }, children),
}));
vi.mock("../WorkStationShell", () => ({
  WorkStationShell: ({
    content,
    statusBar,
    layoutMode,
  }: {
    content: React.ReactNode;
    statusBar: React.ReactNode;
    layoutMode: string;
  }) => h("main", { "data-layout-mode": layoutMode }, content, statusBar),
}));
vi.mock("./SimulatorReplayChrome", () => ({
  SimulatorReplayChrome: ({
    children,
    onTabClick,
    onTabDoubleClick,
    trailingSlot,
  }: React.PropsWithChildren<{
    onTabClick: (id: string) => void;
    onTabDoubleClick?: (id: string) => void;
    trailingSlot?: React.ReactNode;
  }>) =>
    h(
      "div",
      { "data-chrome": true },
      h(
        "button",
        {
          onClick: () => onTabClick("event-2"),
          onDoubleClick: () => onTabDoubleClick?.("event-2"),
        },
        "Event"
      ),
      trailingSlot,
      children
    ),
}));
vi.mock("../NoTabsPlaceholder", () => ({ NoTabsPlaceholder: () => null }));
vi.mock("@src/components/Placeholder", () => ({ Placeholder: () => null }));

function StatefulPane() {
  useEffect(() => {
    mocks.mount();
    return () => {
      mocks.unmount();
    };
  }, []);
  return h("input", { "aria-label": "Draft", defaultValue: "" });
}
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let previousActEnvironment: boolean | undefined;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("ReplayShellLayout", () => {
  it("keeps pane state mounted as an event arrives and layout props change", async () => {
    const onTabClick = vi.fn();
    type WrappedEvent = NonNullable<
      ReplayShellLayoutProps["eventWrapper"]
    >["event"];
    const render = (loaded: boolean) =>
      h(ReplayShellLayout, {
        tabs: [],
        activeEventId: loaded ? "event-2" : null,
        onTabClick,
        // Replay callers can wrap an event that has not arrived yet.
        eventWrapper: {
          event: (loaded
            ? { id: "event-2" }
            : undefined) as unknown as WrappedEvent,
          mode: "simulation",
        },
        workstation: {
          layoutMode: loaded ? "right" : "left",
          statusBar: h("footer", null, loaded ? "Ready" : "Loading"),
        },
        children: h(StatefulPane),
      });
    await act(async () => root.render(render(false)));
    const input = container.querySelector("input")!;
    input.value = "unsaved draft";
    await act(async () => root.render(render(true)));
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("unsaved draft");
    expect(mocks.mount).toHaveBeenCalledTimes(1);
    expect(mocks.unmount).not.toHaveBeenCalled();
    expect(container.querySelector("[data-event-mode]")).not.toBeNull();
    expect(container.querySelector("main")?.dataset.layoutMode).toBe("right");
    expect(container.querySelector("footer")?.textContent).toBe("Ready");
  });
  it("preserves editor double-click and browser trailing actions", async () => {
    const select = vi.fn();
    const open = vi.fn();
    const create = vi.fn();
    await act(async () =>
      root.render(
        h(ReplayShellLayout, {
          tabs: [],
          activeEventId: null,
          onTabClick: select,
          onTabDoubleClick: open,
          trailingSlot: h("button", { onClick: create }, "New tab"),
          children: h("div", null, "Replay"),
        })
      )
    );
    const [eventButton, newButton] = container.querySelectorAll("button");
    await act(async () => {
      eventButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      eventButton.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      newButton.click();
    });
    expect(select).toHaveBeenCalledWith("event-2");
    expect(open).toHaveBeenCalledWith("event-2");
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("keeps diff empty content chrome-only and populated content free of the event adapter", async () => {
    const props = { tabs: [], activeEventId: null, onTabClick: vi.fn() };
    await act(async () =>
      root.render(
        h(ReplayShellLayout, { ...props, children: h("div", null, "Loading") })
      )
    );
    expect(container.querySelector("main")).toBeNull();
    expect(container.querySelector("[data-chrome]")?.textContent).toContain(
      "Loading"
    );
    await act(async () =>
      root.render(
        h(ReplayShellLayout, {
          ...props,
          workstation: { layoutMode: "left" },
          children: h("div", null, "Diff"),
        })
      )
    );
    expect(container.querySelector("main")?.textContent).toBe("Diff");
    expect(container.querySelector("[data-event-mode]")).toBeNull();
  });
});

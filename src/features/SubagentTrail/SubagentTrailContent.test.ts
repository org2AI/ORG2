// @vitest-environment jsdom
import i18next from "i18next";
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { WorkstationTrailHeader } from "@src/components/layout/blocks";
import type { SubagentSession } from "@src/contracts/simulator/subagent";
import common from "@src/i18n/locales/en/common.json";
import sessions from "@src/i18n/locales/en/sessions.json";
import { updateSubagentJobAtom } from "@src/store/session/subagentJobAtom";
import type { SessionTrailSurface } from "@src/store/workstation/sessionTrailSurfaceAtom";
import { invokeTauri } from "@src/util/platform/tauri/init";

import { SubagentTrailContent } from "./SubagentTrailContent";
import { SubagentTrailHeader } from "./SubagentTrailHeader";

const mocks = vi.hoisted(() => ({
  roster: vi.fn(),
  history: vi.fn(),
  retry: vi.fn(),
  parentDetails: vi.fn(),
}));
vi.mock("@src/util/platform/tauri/init", () => ({ invokeTauri: vi.fn() }));
vi.mock("@src/engines/Simulator/hooks/useSubagentRoster", () => ({
  useSubagentRoster: mocks.roster,
}));
vi.mock("@src/engines/Simulator/hooks/useCachedSubagentParentDetails", () => ({
  useCachedSubagentParentDetails: mocks.parentDetails,
}));
vi.mock("./SubagentTrailHistory", () => ({
  SubagentTrailHistory: (props: { session: SubagentSession }) => {
    mocks.history(props.session.sessionId);
    return React.createElement(
      "p",
      { "data-history-id": props.session.sessionId },
      "Full transcript"
    );
  },
}));
const i18n = i18next.createInstance();
await i18n.init({ lng: "en", resources: { en: { common, sessions } } });
const child = (id: string, terminal = false): SubagentSession => ({
  key: id,
  sessionId: id,
  name: "Explore",
  description: `Task ${id}`,
  sessionType: "agent",
  status: terminal ? "completed" : "running",
  rawStatus: terminal ? "completed" : "running",
  startedAtMs: Date.now() - 2000,
  endedAtMs: terminal ? Date.now() : null,
  isTerminal: terminal,
  isBackground: true,
  model: "Example model",
  totalTokens: 1234,
});
let container: HTMLDivElement,
  root: Root,
  store: ReturnType<typeof createStore>;
const surface: SessionTrailSurface = {
  kind: "subagents",
  sessionId: "parent",
  ownerTabId: "tab",
  title: "Subagents",
};
function render(value = surface) {
  act(() =>
    root.render(
      React.createElement(
        Provider,
        { store },
        React.createElement(
          I18nextProvider,
          { i18n },
          React.createElement(
            React.Fragment,
            null,
            React.createElement(
              WorkstationTrailHeader,
              { title: null, standalone: true },
              React.createElement(SubagentTrailHeader, { surface: value })
            ),
            React.createElement(SubagentTrailContent, {
              key: value.sessionId,
              surface: value,
            })
          )
        )
      )
    )
  );
}
function click(text: string) {
  act(() =>
    [...container.querySelectorAll("button")]
      .find(
        (button) =>
          button.textContent?.includes(text) ||
          button.getAttribute("aria-label") === text
      )!
      .click()
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.history.mockClear();
  mocks.retry.mockClear();
  mocks.parentDetails.mockReturnValue(new Map());
  vi.mocked(invokeTauri).mockReset();
  mocks.roster.mockReturnValue({
    sessions: [child("live"), child("done", true)],
    loaded: true,
    error: null,
    retry: mocks.retry,
  });
  store = createStore();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
it("shows the task title and status without dumping raw report content into the overview", () => {
  const task = {
    ...child("done", true),
    description: undefined,
    name: "Stored session title",
  };
  mocks.roster.mockReturnValue({
    sessions: [task],
    loaded: true,
    error: null,
    retry: mocks.retry,
  });
  mocks.parentDetails.mockReturnValue(
    new Map([
      [
        "done",
        {
          title: "Verify toolbar",
          summary:
            "# Report\n| boundary | owner |\nSubagent launched. Session ID: child-123",
        },
      ],
    ])
  );
  render();
  expect(container.textContent).toContain("Verify toolbar");
  expect(container.textContent).not.toContain("# Report");
  expect(container.textContent).not.toContain("Session ID:");
  expect(mocks.history).not.toHaveBeenCalled();
  click("Verify toolbar");
  expect(
    container.querySelector("[data-subagent-header-title]")?.textContent
  ).toBe("Verify toolbar");
  expect(mocks.history).toHaveBeenLastCalledWith("done");
});
it("preserves explicit descriptions and uses stored titles when cached details are absent", () => {
  mocks.parentDetails.mockReturnValue(
    new Map([["live", { title: "Delegate title" }]])
  );
  render();
  expect(container.textContent).toContain("Task live");
  expect(container.textContent).not.toContain("Delegate title");
  expect(container.querySelectorAll("[data-subagent-card]")).toHaveLength(2);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
it("keeps completed tasks, loads only inspected history, and returns to the list", () => {
  render();
  expect(container.querySelectorAll("[data-subagent-card]")).toHaveLength(2);
  expect(mocks.history).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Example model");
  expect(container.textContent).not.toContain("tokens");
  expect(container.querySelector('[aria-label="Stop Task live"]')).toBeNull();
  click("Task live");
  expect(mocks.history).toHaveBeenLastCalledWith("live");
  expect(container.querySelectorAll("[data-history-id]")).toHaveLength(1);
  expect(container.textContent).toContain("Full transcript");
  click("Back");
  expect(container.querySelector('[data-subagent-card="live"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Recent activity");
  expect(container.querySelector('[data-subagent-card="done"]')).not.toBeNull();
  expect(container.querySelector("[aria-expanded]")).toBeNull();
  expect(container.querySelector('[aria-label="View transcript"]')).toBeNull();
});
it("only offers stop for a live job belonging to this parent", () => {
  store.set(updateSubagentJobAtom, {
    sessionId: "other",
    handle: "live",
    agentName: "Explore",
    subagentType: "delegate",
    status: "running",
  });
  render();
  expect(container.querySelector('[aria-label="Stop Task live"]')).toBeNull();
  act(() =>
    store.set(updateSubagentJobAtom, {
      sessionId: "parent",
      handle: "live",
      agentName: "Explore",
      subagentType: "delegate",
      status: "running",
    })
  );
  expect(
    container.querySelector('[aria-label="Stop Task live"]')
  ).not.toBeNull();
  expect(container.querySelector('[aria-label="Stop Task done"]')).toBeNull();
});
it("retains direct navigation on reopen, isolates parents, and handles missing records and retry", () => {
  render();
  click("Task live");
  act(() => root.render(null));
  render();
  expect(container.querySelector('[data-subagent-card="done"]')).not.toBeNull();
  expect(container.querySelector("[data-history-id]")).toBeNull();
  render({ ...surface, sessionId: "other", ownerTabId: "other-tab" });
  expect(container.querySelector('[data-subagent-card="done"]')).not.toBeNull();
  render({ ...surface, childSessionId: "removed" });
  expect(container.textContent).toContain("no longer available");
  mocks.roster.mockReturnValue({
    sessions: [],
    loaded: false,
    error: "offline",
    retry: mocks.retry,
  });
  render();
  click("Retry");
  expect(mocks.retry).toHaveBeenCalledOnce();
});

it("keeps cancelled and paused outcomes distinct and bounds initially rendered cards", () => {
  const rows = Array.from({ length: 24 }, (_, index) =>
    child(String(index), true)
  );
  rows[0] = { ...child("paused"), rawStatus: "paused" };
  rows[1] = {
    ...child("cancelled", true),
    rawStatus: "cancelled",
    status: "failed",
  };
  mocks.roster.mockReturnValue({
    sessions: rows,
    loaded: true,
    error: null,
    retry: mocks.retry,
  });
  render();
  expect(container.querySelectorAll("[data-subagent-card]")).toHaveLength(20);
  expect(
    container.querySelector('[data-subagent-card="paused"]')?.textContent
  ).toContain("Paused");
  expect(
    container.querySelector('[data-subagent-card="cancelled"]')?.textContent
  ).toContain("Cancelled");
  expect(
    container.querySelector('[data-subagent-card="cancelled"]')?.textContent
  ).not.toContain("Failed");
  click("Show more");
  expect(container.querySelectorAll("[data-subagent-card]")).toHaveLength(24);
});

it("restores the list scroll position after closing and reopening", () => {
  render();
  const list = container.querySelector<HTMLDivElement>(".overflow-y-auto")!;
  act(() => {
    list.scrollTop = 180;
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  act(() => root.render(null));
  render();
  expect(
    container.querySelector<HTMLDivElement>(".overflow-y-auto")!.scrollTop
  ).toBe(180);
});

it("opens detail directly and returns without loading list previews", () => {
  render();
  const card = container.querySelector('[data-subagent-card="live"]')!;
  expect(card.querySelector("[aria-expanded]")).toBeNull();
  expect(card.querySelectorAll("button")).toHaveLength(1);
  click("Task live");
  expect(container.textContent).toContain("Full transcript");
  mocks.history.mockClear();
  click("Back");
  expect(mocks.history).not.toHaveBeenCalled();
  expect(container.querySelector("[data-history-id]")).toBeNull();
});

it("uses one title header for detail and restores the overview without changing list intent", () => {
  render();
  click("Task live");
  expect(
    container.querySelector("[data-subagent-header-title]")?.textContent
  ).toBe("Task live");
  expect(container.textContent).not.toContain("Subagents");
  expect(container.querySelectorAll('[aria-label="Back"]')).toHaveLength(1);
  expect(
    container.querySelector('[data-subagent-trail] [aria-label="Back"]')
  ).toBeNull();
  expect(mocks.history).toHaveBeenLastCalledWith("live");
  click("Back");
  expect(container.textContent).toContain("Subagents");
  expect(container.querySelector('[data-subagent-card="done"]')).not.toBeNull();
});

it("resolves direct-entry titles from the roster and uses loading and unavailable states", () => {
  mocks.roster.mockReturnValue({
    sessions: [],
    loaded: false,
    error: null,
    retry: mocks.retry,
  });
  render({ ...surface, childSessionId: "live" });
  expect(
    container.querySelector("[data-subagent-header-title]")?.textContent
  ).toBe(i18n.t("common:status.loading"));
  expect(container.textContent).not.toContain("Subagents");
  mocks.roster.mockReturnValue({
    sessions: [child("live")],
    loaded: true,
    error: null,
    retry: mocks.retry,
  });
  render({ ...surface, childSessionId: "live" });
  expect(
    container.querySelector("[data-subagent-header-title]")?.textContent
  ).toBe("Task live");
  mocks.roster.mockReturnValue({
    sessions: [],
    loaded: true,
    error: null,
    retry: mocks.retry,
  });
  render({ ...surface, childSessionId: "live" });
  expect(
    container.querySelector("[data-subagent-header-title]")?.textContent
  ).toBe(i18n.t("sessions:subagentTrail.recordUnavailable"));
  click("Back");
  expect(container.textContent).toContain("Subagents");
});

it("keeps stopping independent from navigation and allows retry after an error", async () => {
  store.set(updateSubagentJobAtom, {
    sessionId: "parent",
    handle: "live",
    agentName: "Explore",
    subagentType: "delegate",
    status: "running",
  });
  vi.mocked(invokeTauri).mockRejectedValueOnce(new Error("offline"));
  render();
  const card = container.querySelector('[data-subagent-card="live"]')!;
  expect(card.querySelector("button button")).toBeNull();
  expect(card.querySelector('[data-icon="stop"]')).not.toBeNull();
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('[aria-label="Stop Task live"]')!
      .click();
  });
  expect(invokeTauri).toHaveBeenCalledWith("agent_kill_subagent_job", {
    handle: "live",
  });
  expect(mocks.history).not.toHaveBeenCalled();
  expect(card.querySelector('[role="alert"]')).not.toBeNull();
  vi.mocked(invokeTauri).mockResolvedValue(undefined);
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('[aria-label="Stop Task live"]')!
      .click();
  });
  expect(card.querySelector('[role="alert"]')).toBeNull();
  expect(mocks.history).not.toHaveBeenCalled();
});

it("prioritizes running tasks before finished tasks in a bounded page", () => {
  mocks.roster.mockReturnValue({
    sessions: [
      ...Array.from({ length: 24 }, (_, index) => child(String(index), true)),
      child("live"),
    ],
    loaded: true,
    error: null,
    retry: mocks.retry,
  });
  render();
  expect(container.querySelectorAll("[data-subagent-card]")).toHaveLength(20);
  expect(
    container
      .querySelector("[data-subagent-card]")
      ?.getAttribute("data-subagent-card")
  ).toBe("live");
});

it("does not render an empty finished group before its page is visible", () => {
  mocks.roster.mockReturnValue({
    sessions: [
      ...Array.from({ length: 20 }, (_, index) => child(String(index))),
      child("done", true),
    ],
    loaded: true,
    error: null,
    retry: mocks.retry,
  });
  render();
  expect(container.querySelectorAll("section")).toHaveLength(1);
  click(i18n.t("sessions:subagentTrail.showMore"));
  expect(container.querySelectorAll("section")).toHaveLength(2);
  expect(container.querySelector('[data-subagent-card="done"]')).not.toBeNull();
});

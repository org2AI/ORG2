// @vitest-environment jsdom
import type { TFunction } from "i18next";
import { Provider, createStore } from "jotai";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DROPDOWN_PANEL } from "@src/components/Dropdown/tokens";

import { useCloudMemberFilterDropdown } from "./cloudSessionsSection.MemberFilterDropdown";
import type { MemberFilterMenuState } from "./cloudSessionsSection.types";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onFilterChange = vi.fn();
const env = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function Harness() {
  const [memberMenu, setMemberMenu] = useState<MemberFilterMenuState | null>({
    top: 20,
    left: 20,
  });
  const menu = useCloudMemberFilterDropdown({
    orgId: "org-1",
    filter: { kind: "all" },
    memberMenu,
    setMemberMenu,
    rows: [],
    rosterMembers: Array.from({ length: 40 }, (_, index) => ({
      userId: String(index),
      displayName: index === 0 ? "Harry" : `Member ${index}`,
      role: "member",
      status: "active",
    })),
    hiddenRemoteSessionIds: new Set(["org-1|hidden"]),
    setHiddenRemoteSessionIds: vi.fn(),
    presenceMap: {},
    onFilterChange,
    t: ((key: string) => key) as TFunction,
  });
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "button",
      {
        onClick: () => setMemberMenu({ top: 20, left: 20 }),
        "data-testid": "reopen",
      },
      "Open"
    ),
    menu
  );
}

beforeEach(async () => {
  env.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  onFilterChange.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        Provider,
        { store: createStore() },
        React.createElement(Harness)
      )
    );
  });
  await act(async () => {
    vi.advanceTimersByTime(20);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  delete env.IS_REACT_ACT_ENVIRONMENT;
});

it("searches roster names, caps height, selects and resets after reopening", async () => {
  const input = document.querySelector("input")!;
  expect(document.activeElement).toBe(input);
  const portalRoot = document.querySelector<HTMLElement>(
    '[data-testid="sidebar-cloud-member-filter"]'
  )!;
  expect(portalRoot.parentElement).toBe(document.body);
  expect(portalRoot.classList.contains(DROPDOWN_PANEL.zIndexClass)).toBe(true);
  expect(
    document.querySelector<HTMLElement>(".animate-dropdown-in")?.style.maxHeight
  ).toBe(`${DROPDOWN_PANEL.maxHeight}px`);
  expect(document.querySelector('[role="listbox"]')?.className).toContain(
    "overflow-y-auto"
  );
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, " HARRY ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(
    document.querySelectorAll('[role="listbox"] [role="option"]')
  ).toHaveLength(1);
  expect(document.body.textContent).toContain("cloud.sidebar.showHidden");
  await act(async () => {
    document
      .querySelector<HTMLElement>(
        '[data-testid="sidebar-cloud-filter-member-0"]'
      )!
      .click();
  });
  expect(onFilterChange).toHaveBeenCalledWith({
    kind: "member",
    ownerUserId: "0",
  });
  expect(document.querySelector("input")).toBeNull();
  await act(async () => {
    container.querySelector<HTMLElement>('[data-testid="reopen"]')!.click();
  });
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("");
  expect(
    document.querySelectorAll('[role="listbox"] [role="option"]')
  ).toHaveLength(42);
  await act(async () => {
    document
      .querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
  });
  expect(document.querySelector("input")).toBeNull();
});

it("closes on outside click", async () => {
  await act(async () =>
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
  );
  expect(document.querySelector("input")).toBeNull();
});

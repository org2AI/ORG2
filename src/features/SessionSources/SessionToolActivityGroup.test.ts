// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";

import { SessionToolActivityGroup } from "./SessionToolActivityGroup";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      `${key}${options?.count === undefined ? "" : ` ${options.count}`}`,
  }),
}));
let container: HTMLDivElement;
let root: Root;
const open = vi.fn();
const source: Extract<SessionSource, { kind: "tool-group" }> = {
  kind: "tool-group",
  key: "web",
  group: "web",
  operations: [
    {
      callId: "search",
      toolName: "web.search",
      group: "web",
      status: "error",
      error: "No matching results",
      actions: [{ kind: "search", query: "feature specifications" }],
    },
    {
      callId: "open",
      toolName: "web.open",
      group: "web",
      status: "success",
      actions: [{ kind: "open", url: "https://example.com/spec" }],
    },
  ],
};
async function render(value = source, key = "session-a") {
  await act(async () =>
    root.render(
      React.createElement(SessionToolActivityGroup, {
        key,
        source: value,
        onOpenSource: open,
      })
    )
  );
}
function click(label: string) {
  act(() =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes(label))!
      .click()
  );
}
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});
it("discloses search and open independently, renders failures and routes valid web links", async () => {
  await render();
  expect(container.textContent).toContain("toolGroupWeb");
  expect(container.querySelectorAll('[aria-expanded="false"]')).toHaveLength(2);
  expect(container.textContent).not.toContain("feature specifications");
  click("toolSearchCount");
  expect(container.textContent).toContain("feature specifications");
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "No matching results"
  );
  expect(container.querySelector('[role="status"]')?.className).toContain(
    "page-notice"
  );
  expect(container.textContent).not.toContain("https://example.com/spec");
  click("toolOpenCount");
  click("https://example.com/spec");
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "link", url: "https://example.com/spec" })
  );
  await render({ ...source, operations: [...source.operations] });
  expect(container.querySelectorAll('[aria-expanded="true"]')).toHaveLength(2);
  await render(source, "session-b");
  expect(container.querySelectorAll('[aria-expanded="false"]')).toHaveLength(2);
});
it("shows49 repeated generic calls as one row while preserving the activity total on refresh", async () => {
  const operations: typeof source.operations = Array.from(
    { length: 49 },
    (_, index) => ({
      callId: `call-${index}`,
      toolName: "mcp__cua_repl__js",
      group: "mcp:cua",
      status: "success",
      actions: [{ kind: "generic" }],
    })
  );
  const repeated = { ...source, operations };
  await render(repeated);
  expect(container.textContent).toContain("toolCallCount 49");
  click("toolCallCount");
  expect(container.querySelectorAll("[data-tool-activity-call]")).toHaveLength(
    1
  );
  expect(container.textContent).toContain("toolRepeatCount 49");
  await render({ ...repeated, operations: [...operations] });
  expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
  expect(container.querySelectorAll("[data-tool-activity-call]")).toHaveLength(
    1
  );
  expect(container.textContent).toContain("toolCallCount 49");
});

it("keeps differing failures separate and counts repeated failure rows", async () => {
  await render({
    ...source,
    operations: [
      { ...source.operations[0], callId: "a", error: "Error A" },
      { ...source.operations[0], callId: "b", error: "Error A" },
      { ...source.operations[0], callId: "c", error: "Error B" },
    ],
  });
  click("toolSearchCount");
  expect(container.querySelectorAll("[data-tool-activity-call]")).toHaveLength(
    2
  );
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(2);
  expect(container.textContent).toContain("toolSearchCount 3");
  expect(container.textContent).toContain("toolRepeatCount 2");
});

it("bounds expanded details and never opens unsafe tool URLs", async () => {
  await render({
    ...source,
    operations: Array.from({ length: 25 }, (_, index) => ({
      callId: `call-${index}`,
      toolName: "web.open",
      group: "web",
      status: "success",
      actions: [{ kind: "open", url: `javascript:alert(${index})` }],
    })),
  });
  click("toolOpenCount");
  expect(container.querySelectorAll("[data-tool-activity-call]")).toHaveLength(
    20
  );
  expect(container.textContent).toContain("javascript:");
  expect(
    [...container.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("javascript:")
    )
  ).toBe(false);
  click("toolLoadMore");
  expect(container.querySelectorAll("[data-tool-activity-call]")).toHaveLength(
    25
  );
  expect(open).not.toHaveBeenCalled();
});

// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { makeSessionEvent } from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";
import { ActivitySparkIcon, WaypointsIcon } from "@src/icons";
import { getToolDisplayLabelFromRegistry } from "@src/util/ui/rendering/registryToolLabel";

import WorkActivityGroup from ".";
import TerminalActivityGroup from "../TerminalActivityGroup";
import { summarizeWorkActivity } from "./summary";

const environment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

vi.mock("@src/engines/ChatPanel/hooks/useChatEventReplay", () => ({
  useChatEventReplay: () => ({ replayEventById: vi.fn(), canReplay: false }),
}));
vi.mock("@src/engines/SessionCore/rendering/registry/events", () => ({
  getChatLazyComponent:
    () =>
    ({ event }: { event: { id: string } }) =>
      createElement("div", { "data-event": event.id }, event.id),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      `${key}:${opts?.count ?? ""}`,
  }),
}));
const tool = (id: string, canonical = "read_file") =>
  makeSessionEvent({
    id,
    action_type: "tool_call",
    function: canonical,
    uiCanonical: canonical,
    args: { command: "echo hello" },
    result: { success: true },
  });

it("uses existing group families and category counts", () => {
  expect(
    summarizeWorkActivity([tool("r"), tool("s", "code_search")]).group
  ).toBe("explore");
  const summary = summarizeWorkActivity([tool("r"), tool("c", "run_shell")]);
  expect(summary.group).toBe("mixed");
  expect([...summary.counts]).toEqual([
    ["tools.exploreSummary.read", 1],
    ["tools.terminalSummary.command", 1],
  ]);
});

describe("work activity expansion", () => {
  it("keeps the summary collapsed, supports keyboard expansion, and mounts only one page", () => {
    const events = Array.from({ length: 45 }, (_, index) =>
      tool(`read-${index}`)
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => root.render(createElement(WorkActivityGroup, { events })));
      const header =
        container.querySelector<HTMLElement>(".chat-block-header")!;
      expect(header.getAttribute("aria-expanded")).toBe("false");
      expect(container.textContent).toContain("tools.explore:");
      expect(container.querySelectorAll("[data-event]")).toHaveLength(0);
      act(() =>
        header.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        )
      );
      expect(container.querySelectorAll("[data-event]")).toHaveLength(20);
      expect(container.querySelector('[data-event="read-0"]')).not.toBeNull();
      const next = container.querySelector<HTMLButtonElement>(
        '[aria-label="pagination.nextPage:"]'
      )!;
      expect(next).not.toBeNull();
      act(() => next.click());
      expect(container.querySelector('[data-event="read-20"]')).not.toBeNull();
      expect(container.querySelectorAll("[data-event]")).toHaveLength(20);
      act(() => header.click());
      expect(container.querySelectorAll("[data-event]")).toHaveLength(0);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("updates a running summary without reopening the group", () => {
    const events = [
      tool("r"),
      { ...tool("c", "run_shell"), displayStatus: "running" as const },
    ];
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() => root.render(createElement(WorkActivityGroup, { events })));
      expect(container.textContent).toContain("chat.performActions:2");
      act(() =>
        root.render(
          createElement(WorkActivityGroup, {
            events: [tool("r"), tool("c", "run_shell")],
          })
        )
      );
      expect(container.textContent).toContain("chat.performActions:2");
      expect(container.querySelectorAll("[data-event]")).toHaveLength(0);
    } finally {
      act(() => root.unmount());
    }
  });

  it.each([
    ["read_file", "tools.explore:"],
    ["code_search", "tools.explore:"],
    ["list_dir", "tools.explore:"],
    ["glob_file_search", "tools.explore:"],
    ["query_lsp", "tools.explore:"],
    ["edit_file", "tools.editFiles:"],
    ["delete_file", "tools.editFiles:"],
    ["run_shell", "tools.runCommands:"],
    ["mcp_tool", "tools.runCommands:"],
  ])(
    "retains the existing category label for a pure %s group",
    (canonical, label) => {
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(
        createElement(WorkActivityGroup, {
          events: [
            tool("a", canonical),
            tool("b", canonical),
            tool("c", canonical),
          ],
        })
      );
      expect(
        container.querySelector(".chat-block-header")?.textContent
      ).toContain(label);
      expect(container.textContent).not.toContain("chat.performActions");
    }
  );

  it.each(["custom_probe", "generate_image", "manage_todo", "subagent"])(
    "uses the normal tool label for a pure %s group",
    (canonical) => {
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(
        createElement(WorkActivityGroup, {
          events: [tool("a", canonical), tool("b", canonical)],
        })
      );
      expect(
        container.querySelector(".chat-block-header")?.textContent
      ).toContain(getToolDisplayLabelFromRegistry(canonical));
      expect(container.textContent).not.toContain("chat.performActions");
    }
  );

  it("uses the same terminal-only header in compact and normal modes", () => {
    const events = [
      tool("a", "run_shell"),
      tool("b", "run_shell"),
      tool("c", "run_shell"),
    ];
    const compact = document.createElement("div");
    compact.innerHTML = renderToStaticMarkup(
      createElement(WorkActivityGroup, { events })
    );
    const normal = document.createElement("div");
    normal.innerHTML = renderToStaticMarkup(
      createElement(TerminalActivityGroup, { events, closedByBoundary: true })
    );
    expect(compact.querySelector(".chat-block-header")?.textContent).toBe(
      normal.querySelector(".chat-block-header")?.textContent
    );
    expect(compact.textContent).toContain("tools.runCommands:");
    expect(compact.textContent).toContain("tools.terminalSummary.command:3");
    const iconPaths = (container: HTMLElement) =>
      [...container.querySelectorAll(".chat-block-icon path")].map((path) =>
        path.getAttribute("d")
      );
    expect(iconPaths(compact)).toEqual(iconPaths(normal));
  });

  it.each([
    ["read_file", WaypointsIcon],
    ["run_shell", ActivitySparkIcon],
  ] as const)(
    "selects the correct icon when reads are followed by %s",
    (canonical, icon) => {
      const container = document.createElement("div");
      const root = createRoot(container);
      try {
        act(() =>
          root.render(
            createElement(WorkActivityGroup, {
              events: [tool("r"), tool("other", canonical)],
            })
          )
        );
        const paths = [
          ...container.querySelectorAll(".chat-block-icon path"),
        ].map((path) => path.getAttribute("d"));
        expect(paths).toEqual(
          icon.filter(([tag]) => tag === "path").map(([, attrs]) => attrs.d)
        );
        expect(
          container.querySelector(".chat-block-icon")?.className
        ).toContain("size-4");
      } finally {
        act(() => root.unmount());
      }
    }
  );
});

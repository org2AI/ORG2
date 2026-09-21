// @vitest-environment jsdom
import { Provider, createStore, useAtomValue } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatCollapseState } from "@src/engines/ChatPanel/ChatCollapseScope";
import {
  makeChatItem,
  makeSessionEvent,
} from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";
import { sessionRuntimeStatusAtom } from "@src/store/session/cliSessionStatusAtom";

import { CHAT_FOOTER_SPACER } from "../config/chatFooterSpacer";
import type { ChatGroupMeta } from "../hooks/useChatGroups";
import { useTailTurnPhase } from "../hooks/useTailTurnCollapse";
import { projectChatHistory } from "../projection/core";
import {
  GroupHeaderRenderer,
  type GroupHeaderRendererProps,
} from "./GroupHeaderRenderer";

const compare = (
  GroupHeaderRenderer as unknown as {
    compare: (
      left: GroupHeaderRendererProps,
      right: GroupHeaderRendererProps
    ) => boolean;
  }
).compare;

const headers = [
  "update the PR",
  "[Request interrupted by user]",
  "fix the conflict",
].map((text, index) =>
  makeChatItem(
    makeSessionEvent({
      id: `user-${index}`,
      source: "user",
      actionType: "raw",
      functionName: "user_message",
      displayText: text,
      displayVariant: "message",
    })
  )
);

function meta(index: number, hasBody: boolean): ChatGroupMeta {
  return {
    turnId: `user-${index}`,
    durationMs: 0,
    itemCount: 0,
    bodyEventCount: 0,
    hasBody,
    previewText: "",
    startMs: null,
    endMs: null,
    unloadedTurn: null,
  };
}

function props(
  groupIndex: number,
  hasBody: boolean[]
): GroupHeaderRendererProps {
  return {
    groupIndex,
    groupHeaders: headers,
    groupMeta: hasBody.map((value, index) => meta(index, value)),
    groupCount: headers.length,
  };
}

describe("GroupHeaderRenderer after a round the agent never worked in", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function marginTopOf(groupIndex: number, hasBody: boolean[]): string {
    act(() =>
      root.render(
        createElement(GroupHeaderRenderer, props(groupIndex, hasBody))
      )
    );
    const header = container.firstElementChild as HTMLElement | null;
    expect(header?.textContent).toContain(
      headers[groupIndex].event?.displayText
    );
    return header?.style.marginTop ?? "";
  }

  it("stacks the next user message without a round gap", () => {
    const hasBody = [false, false, true];

    expect(marginTopOf(1, hasBody)).toBe("");
    expect(marginTopOf(2, hasBody)).toBe("");
  });

  it("keeps the round gap after a round with a body", () => {
    expect(marginTopOf(1, [true, false, true])).toBe(
      `${CHAT_FOOTER_SPACER.ROUND_GAP_PX}px`
    );
  });

  it("re-renders when the preceding round's body changes", () => {
    const bodyless = props(1, [false, false, true]);

    expect(compare(bodyless, { ...bodyless })).toBe(true);
    expect(compare(bodyless, props(1, [true, false, true]))).toBe(false);
  });
});

describe("GroupHeaderRenderer streaming completion", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    "shows and collapses a streaming turn on idle (with tools=%s)",
    (withTools) => {
      const store = createStore();
      store.set(sessionRuntimeStatusAtom, "running");
      const chatHistory = [
        makeSessionEvent({
          id: "user-turn",
          source: "user",
          actionType: "raw",
          functionName: "user_message",
          displayText: "Run a command",
          displayVariant: "message",
        }),
        ...(withTools
          ? [
              makeSessionEvent({
                id: "tool",
                source: "assistant",
                actionType: "tool_call",
                functionName: "run_shell",
                uiCanonical: "run_shell",
                displayVariant: "tool_call",
                displayText: "command activity",
                displayStatus: "completed",
                args: { command: "pwd" },
              }),
            ]
          : []),
        makeSessionEvent({
          id: "reply",
          source: "assistant",
          actionType: "assistant_message",
          functionName: "agent_message",
          uiCanonical: "agent_message",
          displayVariant: "message",
          displayText: "final reply",
          displayStatus: "completed",
        }),
      ];
      function StreamingTurn() {
        const tailTurnPhase = useTailTurnPhase({
          activeId: "sdeagent-streaming",
          chatHistory,
          disableTailCollapse: false,
          groupChat: null,
          sessionStatus: "running",
        });
        const { turnCollapseOverrideAtom } = useChatCollapseState();
        const collapseOverrides = useAtomValue(turnCollapseOverrideAtom);
        const groups = projectChatHistory(chatHistory, {
          groups: { tailTurnPhase, collapseOverrides },
        }).groups!;
        return createElement(
          "div",
          null,
          createElement(GroupHeaderRenderer, {
            groupIndex: 0,
            groupCount: 1,
            groupHeaders: groups.groupHeaders,
            groupMeta: groups.groupMeta,
            tailTurnPhase,
          }),
          createElement(
            "output",
            null,
            groups.flatItems
              .flatMap(
                (item) =>
                  item.activityStackGroup?.events.map((event) => event.id) ?? [
                    item.event?.id,
                  ]
              )
              .join(",")
          )
        );
      }
      act(() =>
        root.render(
          createElement(Provider, { store }, createElement(StreamingTurn))
        )
      );
      expect(
        container.querySelector('[data-testid="turn-collapse-toggle"]')
      ).toBeNull();
      act(() => store.set(sessionRuntimeStatusAtom, "idle"));
      const toggle = container.querySelector<HTMLButtonElement>(
        '[data-testid="turn-collapse-toggle"]'
      )!;
      expect(toggle).not.toBeNull();
      expect(toggle.textContent).toMatch(/Agent worked for|agentWorkedFor/);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector("output")?.textContent).toBe("reply");
      act(() => toggle.click());
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      if (withTools)
        expect(container.querySelector("output")?.textContent).toContain(
          "tool"
        );
    }
  );
});

// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeChatItem,
  makeSessionEvent,
} from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";

import type { AgentOrgExecution } from "../../agentOrgExecution";
import type { ChatGroupMeta } from "../../hooks/useChatGroups";
import ConversationMinimap from "../ConversationMinimap";
import TurnPageList from "../TurnPageList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { preview?: string }) => values?.preview ?? key,
  }),
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 36,
      })),
    measureElement: vi.fn(),
  }),
}));

describe.each(["minimap", "page list"] as const)(
  "%s execution navigation",
  (surface) => {
    let host: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
    });
    afterEach(() => {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    });

    async function render(
      sourceKind?: AgentOrgExecution["sourceKind"],
      loaded = true
    ) {
      const execution: AgentOrgExecution | undefined = sourceKind
        ? {
            turnIntentId: "actual-turn",
            participantId: "coordinator",
            participantName: "Coordinator",
            sourceKind,
          }
        : undefined;
      const text =
        !sourceKind || sourceKind === "user_input"
          ? "Build a racing game"
          : "[Agent Org inbox message id=35 from_member_id=system]";
      const headers = [
        makeChatItem(makeSessionEvent({ displayText: loaded ? text : "" })),
        makeChatItem(makeSessionEvent({ displayText: "Next request" })),
      ];
      const meta: ChatGroupMeta = {
        execution,
        turnId: "actual-turn",
        durationMs: 0,
        itemCount: 1,
        bodyEventCount: 1,
        hasBody: true,
        previewText: "",
        startMs: null,
        endMs: null,
        unloadedTurn: null,
      };
      const onNavigate = vi.fn();
      await act(async () =>
        root.render(
          surface === "minimap"
            ? createElement(ConversationMinimap, {
                groupHeaders: headers,
                groupMeta: [meta, { ...meta, execution: undefined }],
                groupCounts: [1, 1],
                flatItems: [],
                activeGroupIndex: 0,
                visibleGroupIndices: [0],
                isAtBottom: false,
                isScrolling: false,
                onNavigate,
              })
            : createElement(TurnPageList, {
                surfaceBgClass: "",
                bottomInset: 0,
                pages: [
                  {
                    startGroupIndex: 0,
                    endGroupIndex: 0,
                    flatStartIndex: 0,
                    flatEndIndex: 0,
                    cursorIdeSummary: null,
                  },
                ],
                groupHeaders: headers,
                groupMeta: [meta],
                currentPageIndex: 0,
                turnPageSortAscending: true,
                onSelectTurnPage: onNavigate,
              })
        )
      );
      const button = host.querySelector<HTMLButtonElement>("button")!;
      expect(button).not.toBeNull();
      await act(async () => button.click());
      expect(onNavigate).toHaveBeenCalledWith(0);
      return button.getAttribute("aria-label") ?? button.textContent;
    }

    it.each(["member_messages", "task_dispatch", "final_summary"] as const)(
      "keeps the typed %s preview stable when its body loads",
      async (source) => {
        const title = `Coordinator · sessions:agentOrgExecution.sources.${source}`;
        expect(await render(source, false)).toContain(title);
        expect(await render(source, true)).toContain(title);
        expect(host.textContent).not.toContain("from_member_id");
      }
    );

    it.each(["user_input", undefined] as const)(
      "preserves the actual prompt for %s history",
      async (source) => {
        expect(await render(source)).toContain("Build a racing game");
      }
    );
  }
);

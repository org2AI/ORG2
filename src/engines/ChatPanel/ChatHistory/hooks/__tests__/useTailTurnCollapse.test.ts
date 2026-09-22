// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { sessionRuntimeStatusAtom } from "@src/store/session/cliSessionStatusAtom";
import { updateSubagentJobAtom } from "@src/store/session/subagentJobAtom";

import type { GroupChatContextValue } from "../../GroupChatView/GroupChatContext";
import {
  findTailTurnId,
  resolveTailTurnAgentWorking,
  useTailTurnPhase,
} from "../useTailTurnCollapse";

function event(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    id: "event-id",
    sessionId: "session-id",
    source: "assistant",
    args: {},
    result: {},
    ...overrides,
  } as SessionEvent;
}

describe("findTailTurnId", () => {
  it("returns the latest standard user turn and ignores inbox transcript rows", () => {
    const events = [
      event({ id: "user-1", source: "user" }),
      event({ id: "assistant-1" }),
      event({
        id: "inbox-row",
        source: "user",
        args: { agentOrgInboxTranscript: true },
      }),
    ];

    expect(findTailTurnId(events, null)).toBe("user-1");
  });

  it("uses the group-chat coordinator boundary predicate", () => {
    const events = [
      event({ id: "coordinator-turn", source: "user" }),
      event({ id: "member-turn", source: "user" }),
    ];
    const groupChat = {
      enabled: true,
      isCoordinatorTurnHeader: (candidate: SessionEvent) =>
        candidate.id === "coordinator-turn",
    } as GroupChatContextValue;

    expect(findTailTurnId(events, groupChat)).toBe("coordinator-turn");
  });

  it("returns null when no turn boundary exists", () => {
    expect(findTailTurnId([event({ id: "assistant-only" })], null)).toBeNull();
  });
});

describe("resolveTailTurnAgentWorking", () => {
  it.each(["running", "waiting_for_user", "pending", "queued"])(
    "uses the sidebar session status for an active external session (%s)",
    (sessionStatus) => {
      expect(
        resolveTailTurnAgentWorking({
          activeId: "codexapp-session-id",
          isAgentWorking: false,
          sessionStatus,
        })
      ).toBe(true);
    }
  );

  it.each(["completed", "failed", "idle", undefined])(
    "treats an inactive external session as idle (%s)",
    (sessionStatus) => {
      expect(
        resolveTailTurnAgentWorking({
          activeId: "claudecodeapp-session-id",
          isAgentWorking: true,
          sessionStatus,
        })
      ).toBe(false);
    }
  );

  it("keeps the foreground runtime signal authoritative for native sessions", () => {
    expect(
      resolveTailTurnAgentWorking({
        activeId: "sdeagent-session-id",
        isAgentWorking: true,
        sessionStatus: "completed",
      })
    ).toBe(true);
  });
});

describe("useTailTurnPhase streaming lifecycle", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let store: ReturnType<typeof createStore>;
  let options: Parameters<typeof useTailTurnPhase>[0];

  function Probe() {
    const phase = useTailTurnPhase(options);
    return createElement("output", null, phase);
  }
  function render() {
    act(() =>
      root.render(createElement(Provider, { store }, createElement(Probe)))
    );
    return container.textContent;
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    root = createRoot(container);
    store = createStore();
    store.set(sessionRuntimeStatusAtom, "running");
    options = {
      activeId: "sdeagent-one",
      chatHistory: [event({ id: "turn-1", source: "user" })],
      disableTailCollapse: false,
      groupChat: null,
      sessionStatus: "running",
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  function updateChild(
    handle: string,
    status: "running" | "completed",
    sessionId = options.activeId!
  ) {
    act(() =>
      store.set(updateSubagentJobAtom, {
        sessionId,
        handle,
        status,
        agentName: "Worker",
        subagentType: "delegate",
      })
    );
  }

  it("waits for the last child after the parent idles", () => {
    updateChild("child-1", "running");
    updateChild("child-2", "running");
    expect(render()).toBe("running");
    act(() => store.set(sessionRuntimeStatusAtom, "idle"));
    expect(container.textContent).toBe("running");
    updateChild("child-1", "completed");
    expect(container.textContent).toBe("running");
    updateChild("child-2", "completed");
    expect(container.textContent).toBe("complete");
  });

  it("waits for the parent when children finish first", () => {
    updateChild("child", "running");
    expect(render()).toBe("running");
    updateChild("child", "completed");
    expect(container.textContent).toBe("running");
    act(() => store.set(sessionRuntimeStatusAtom, "idle"));
    expect(container.textContent).toBe("complete");
  });

  it("invalidates completion if a live child arrives later", () => {
    store.set(sessionRuntimeStatusAtom, "idle");
    expect(render()).toBe("complete");
    updateChild("child", "running");
    expect(container.textContent).toBe("running");
    act(() => store.set(sessionRuntimeStatusAtom, "running"));
    updateChild("child", "completed");
    expect(container.textContent).toBe("running");
    act(() => store.set(sessionRuntimeStatusAtom, "idle"));
    expect(container.textContent).toBe("complete");
  });

  it("ignores live children belonging to another session", () => {
    updateChild("other-child", "running", "sdeagent-other");
    store.set(sessionRuntimeStatusAtom, "idle");
    expect(render()).toBe("complete");
  });

  it("also waits for tracked children of completed external sessions", () => {
    options = {
      ...options,
      activeId: "codexapp-one",
      sessionStatus: "completed",
    };
    updateChild("child", "running");
    expect(render()).toBe("running");
    updateChild("child", "completed");
    expect(container.textContent).toBe("complete");
  });

  it("keeps completion through dispatch-before-transcript, then resets for the next turn", () => {
    expect(render()).toBe("running");
    act(() => store.set(sessionRuntimeStatusAtom, "idle"));
    expect(container.textContent).toBe("complete");
    act(() => store.set(sessionRuntimeStatusAtom, "running"));
    expect(container.textContent).toBe("complete");
    options = {
      ...options,
      chatHistory: [
        ...options.chatHistory,
        event({ id: "turn-2", source: "user" }),
      ],
    };
    expect(render()).toBe("running");
  });

  it("does not share completion between sessions or restore an old latch on return", () => {
    store.set(sessionRuntimeStatusAtom, "idle");
    expect(render()).toBe("complete");
    act(() => store.set(sessionRuntimeStatusAtom, "running"));
    options = { ...options, activeId: "sdeagent-two" };
    expect(render()).toBe("running");
    options = { ...options, activeId: "sdeagent-one" };
    expect(render()).toBe("running");
  });

  it.each(["waiting_for_user", "waiting_for_funds"] as const)(
    "keeps an open turn expanded during %s",
    (status) => {
      store.set(sessionRuntimeStatusAtom, status);
      expect(render()).toBe("running");
    }
  );

  it("uses external session completion independently of the foreground engine", () => {
    options = { ...options, activeId: "codexapp-one" };
    expect(render()).toBe("running");
    options = { ...options, sessionStatus: "completed" };
    expect(render()).toBe("complete");
  });

  it("honors surfaces that disable tail collapse", () => {
    store.set(sessionRuntimeStatusAtom, "idle");
    options = { ...options, disableTailCollapse: true };
    expect(render()).toBe("running");
  });
});

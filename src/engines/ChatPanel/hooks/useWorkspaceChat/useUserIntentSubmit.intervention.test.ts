import { Provider, createStore } from "jotai";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { postStopDispatchSessionsAtom } from "@src/store/session/cliSessionStatusAtom";
import { messageQueueAtom } from "@src/store/ui/messageQueueAtom";

import {
  type SubmitUserIntentOptions,
  useUserIntentSubmit,
} from "./useUserIntentSubmit";

const SESSION_ID = "agent-builtin:sde-worker-intervention";

const mocks = vi.hoisted(() => ({
  beginOptimisticTurn: vi.fn(),
  dispatchMessageBySessionType: vi.fn(),
  getTurnPhase: vi.fn(),
  mintTurnIntentId: vi.fn(),
}));

vi.mock("@src/engines/SessionCore/control/optimisticTurnStatus", () => ({
  beginOptimisticTurn: mocks.beginOptimisticTurn,
}));

vi.mock("@src/engines/SessionCore/control/turnLifecycle", () => ({
  getTurnPhase: mocks.getTurnPhase,
}));

vi.mock("@src/engines/SessionCore/sync/adapters/shared/eventFactories", () => ({
  mintTurnIntentId: mocks.mintTurnIntentId,
}));

vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("./useMessageDispatch", () => ({
  useMessageDispatch: () => ({
    dispatchMessageBySessionType: mocks.dispatchMessageBySessionType,
  }),
}));

function renderSubmitHook(store: ReturnType<typeof createStore>) {
  let submit: ((options: SubmitUserIntentOptions) => Promise<void>) | undefined;

  function HookProbe(): null {
    // Test probe: capture the hook API synchronously from server rendering.
    // eslint-disable-next-line react-hooks/globals -- server-rendered test probe synchronously exports the hook callback; the component never mounts or re-renders
    submit = useUserIntentSubmit({ getSessionId: () => SESSION_ID });
    return null;
  }

  renderToString(createElement(Provider, { store }, createElement(HookProbe)));

  if (!submit) throw new Error("useUserIntentSubmit hook was not captured");
  return submit;
}

describe("useUserIntentSubmit Agent Org intervention", () => {
  beforeEach(() => {
    mocks.beginOptimisticTurn.mockReset();
    mocks.dispatchMessageBySessionType.mockReset().mockResolvedValue(undefined);
    mocks.getTurnPhase.mockReset().mockReturnValue("idle");
    mocks.mintTurnIntentId.mockReset().mockReturnValue("turn-intent-1");
  });

  it("routes the direct turn through the shared user-intent dispatcher", async () => {
    const submit = renderSubmitHook(createStore());

    await submit({ sessionId: SESSION_ID, displayContent: "hello worker" });

    expect(mocks.dispatchMessageBySessionType).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        content: "hello worker",
        visibleText: "hello worker",
        turnIntentId: "turn-intent-1",
      })
    );
  });

  it("keeps a Stop episode scoped to its own session", async () => {
    const store = createStore();
    store.set(postStopDispatchSessionsAtom, { "session-a": true });
    const submit = renderSubmitHook(store);

    await submit({
      sessionId: SESSION_ID,
      displayContent: "session b message",
    });

    expect(store.get(messageQueueAtom)).toEqual([]);
    expect(mocks.dispatchMessageBySessionType).toHaveBeenCalledOnce();
    expect(store.get(postStopDispatchSessionsAtom)).toEqual({
      "session-a": true,
    });
  });

  it("only enqueues while the current turn is busy", async () => {
    const store = createStore();
    const submit = renderSubmitHook(store);
    mocks.getTurnPhase.mockReturnValue("working");

    await submit({ sessionId: SESSION_ID, displayContent: "queued follow-up" });

    expect(store.get(messageQueueAtom)).toEqual([
      expect.objectContaining({
        sessionId: SESSION_ID,
        content: "queued follow-up",
        displayContent: "queued follow-up",
        turnIntentId: "turn-intent-1",
        priority: "next",
        status: "queued",
      }),
    ]);
    expect(mocks.dispatchMessageBySessionType).not.toHaveBeenCalled();
  });

  it("does not run a second optimistic-row cleanup when dispatch fails", async () => {
    const submit = renderSubmitHook(createStore());
    mocks.dispatchMessageBySessionType.mockRejectedValue(
      new Error("backend send unavailable")
    );

    await expect(
      submit({ sessionId: SESSION_ID, displayContent: "retry me" })
    ).rejects.toThrow("backend send unavailable");

    expect(mocks.dispatchMessageBySessionType).toHaveBeenCalledOnce();
  });
});

// @vitest-environment jsdom
import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ActiveMessageDelivery,
  type QueuedMessage,
  activeMessageDeliveriesAtom,
  messageDeliveryRecordsAtom,
  messageQueueAtom,
  messageQueueHydratedAtom,
} from "@src/store/ui/messageQueueAtom";

import {
  flushMessageQueuePersistence,
  handoffQueuedMessageToActiveDelivery,
  hydrateMessageQueue,
  refreshMessageDeliveries,
  returnActiveDeliveryToMessageQueue,
} from "../messageQueuePersistence";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  persist: vi.fn(),
  handoff: vi.fn(),
  returnToQueue: vi.fn(),
}));

vi.mock("@src/store/ui/messageQueueRepository", () => ({
  loadDurableMessageDeliveries: mocks.load,
  persistDurableMessageQueue: mocks.persist,
  handoffDurableMessageDelivery: mocks.handoff,
  returnDurableMessageDeliveryToQueue: mocks.returnToQueue,
}));

function message(
  id: string,
  overrides: Partial<QueuedMessage> = {}
): QueuedMessage {
  return {
    id,
    turnIntentId: `intent-${id}`,
    sessionId: "session-1",
    content: id,
    displayContent: id,
    priority: "next",
    status: "queued",
    createdAt: `2026-07-23T00:00:0${id.length}.000Z`,
    ...overrides,
  };
}

function activeDelivery(
  id: string,
  overrides: Partial<ActiveMessageDelivery> = {}
): ActiveMessageDelivery {
  return {
    ...message(id),
    conversationDispatch: {
      kind: "canonical_conversation",
      root: {
        authority: "local-session",
        authorityScope: [],
        conversationId: "root-1",
      },
      target: {
        cliAgentType: "codex",
        accountId: "openai-1",
        model: "gpt-5.6-sol",
        workspaceRepoPath: "/repo",
      },
    },
    status: "accepted",
    runnerSessionId: `runner-${id}`,
    ...overrides,
  };
}

describe("messageQueuePersistence", () => {
  beforeEach(() => {
    mocks.load.mockReset().mockResolvedValue({ queue: [], active: [] });
    mocks.persist.mockReset().mockResolvedValue(undefined);
    mocks.handoff.mockReset();
    mocks.returnToQueue.mockReset();
  });

  it("hydrates before opening the dispatch gate", async () => {
    const durable = message("durable");
    mocks.load.mockResolvedValue({ queue: [durable], active: [] });
    const store = createStore();

    expect(store.get(messageQueueHydratedAtom)).toBe(false);
    await hydrateMessageQueue(store);

    const recovered = {
      ...durable,
      priority: "next" as const,
      requiresExplicitDispatch: true,
    };
    expect(store.get(messageQueueAtom)).toEqual([recovered]);
    expect(store.get(messageQueueHydratedAtom)).toBe(true);
    expect(mocks.persist).toHaveBeenCalledWith([recovered]);
  });

  it("deduplicates by turn intent and lets live mutations win hydration races", async () => {
    const durable = message("durable", { turnIntentId: "shared-intent" });
    const live = message("live", {
      turnIntentId: "shared-intent",
      content: "edited while loading",
    });
    const store = createStore();
    store.set(messageQueueAtom, [live]);
    mocks.load.mockResolvedValue({ queue: [durable], active: [] });

    await hydrateMessageQueue(store);

    expect(store.get(messageQueueAtom)).toEqual([live]);
  });

  it("persists queue mutations after hydration", async () => {
    const store = createStore();
    await hydrateMessageQueue(store);
    mocks.persist.mockClear();

    const next = message("next");
    store.set(messageQueueAtom, [next]);

    expect(mocks.persist).toHaveBeenCalledWith([next]);
  });

  it("exposes the current durable queue write as a commit barrier", async () => {
    const store = createStore();
    await hydrateMessageQueue(store);
    let release!: () => void;
    mocks.persist.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    const next = message("barrier");
    store.set(messageQueueAtom, [next]);
    let flushed = false;
    const flush = flushMessageQueuePersistence(store).then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    expect(mocks.persist).toHaveBeenCalledWith([next]);

    release();
    await flush;
    expect(flushed).toBe(true);
  });

  it("retries a transient durable read and installs persistence after recovery", async () => {
    const store = createStore();
    mocks.load
      .mockRejectedValueOnce(new Error("store starting"))
      .mockResolvedValueOnce({ queue: [], active: [] });

    await expect(hydrateMessageQueue(store)).rejects.toThrow("store starting");
    expect(store.get(messageQueueHydratedAtom)).toBe(false);

    await hydrateMessageQueue(store);
    mocks.persist.mockClear();
    const next = message("after-recovery");
    store.set(messageQueueAtom, [next]);

    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.persist).toHaveBeenCalledWith([next]);
  });

  it("does not resurrect a deletion while a durable refresh is racing it", async () => {
    const old = message("old");
    let durable: QueuedMessage[] = [old];
    let releasePersist!: () => void;
    mocks.load.mockImplementation(async () => ({ queue: durable, active: [] }));
    const store = createStore();
    await hydrateMessageQueue(store);
    mocks.persist.mockImplementation(
      (snapshot: QueuedMessage[]) =>
        new Promise<void>((resolve) => {
          releasePersist = () => {
            durable = snapshot;
            resolve();
          };
        })
    );

    store.set(messageQueueAtom, []);
    const refresh = refreshMessageDeliveries(store);
    await Promise.resolve();
    expect(store.get(messageQueueAtom)).toEqual([]);
    releasePersist();
    await refresh;

    expect(store.get(messageQueueAtom)).toEqual([]);
  });

  it("hydrates accepted recovery metadata into the same delivery registry", async () => {
    const queued = message("shared");
    const active = activeDelivery("shared", {
      runnerSessionId: "cliagent-runner",
    });
    mocks.load.mockResolvedValue({ queue: [queued], active: [active] });
    const store = createStore();

    await hydrateMessageQueue(store);

    expect(store.get(messageQueueAtom)).toEqual([]);
    expect(store.get(activeMessageDeliveriesAtom)).toEqual([active]);

    const next = message("next");
    store.set(messageQueueAtom, [next]);
    expect(store.get(messageQueueAtom)).toEqual([next]);
    expect(store.get(activeMessageDeliveriesAtom)).toEqual([active]);
  });

  it("publishes the durable active snapshot after a queue handoff", async () => {
    const queued = message("queued", {
      conversationDispatch: activeDelivery("queued").conversationDispatch,
    });
    const delivery = activeDelivery("queued", {
      status: "preparing",
      runnerSessionId: undefined,
    });
    const peer = activeDelivery("peer");
    mocks.handoff.mockResolvedValue({
      delivery,
      queue: [],
      active: [peer, delivery],
    });
    const store = createStore();
    store.set(messageQueueAtom, [queued]);

    await handoffQueuedMessageToActiveDelivery(store, delivery);

    expect(store.get(messageQueueAtom)).toEqual([]);
    expect(store.get(activeMessageDeliveriesAtom)).toEqual([peer, delivery]);
  });

  it("preserves a concurrent enqueue while queue handoff is pending", async () => {
    const queued = message("queued", {
      conversationDispatch: activeDelivery("queued").conversationDispatch,
    });
    const concurrent = message("concurrent");
    const delivery = activeDelivery("queued", {
      status: "preparing",
      runnerSessionId: undefined,
    });
    let release!: () => void;
    mocks.handoff.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ delivery, queue: [], active: [delivery] });
        })
    );
    const store = createStore();
    store.set(messageQueueAtom, [queued]);

    const handoff = handoffQueuedMessageToActiveDelivery(store, delivery);
    await vi.waitFor(() => expect(mocks.handoff).toHaveBeenCalledOnce());
    store.set(messageQueueAtom, (current) => [...current, concurrent]);
    release();
    await handoff;

    expect(store.get(messageQueueAtom)).toEqual([concurrent]);
    expect(store.get(activeMessageDeliveriesAtom)).toEqual([delivery]);
  });

  it("publishes the durable active snapshot when an owner returns to queue", async () => {
    const returning = message("returning", {
      conversationDispatch: activeDelivery("returning").conversationDispatch,
      requiresExplicitDispatch: true,
    });
    const staleLocalPeer = activeDelivery("stale-peer");
    const durablePeer = activeDelivery("durable-peer");
    mocks.returnToQueue.mockResolvedValue({
      message: returning,
      active: [durablePeer],
    });
    const store = createStore();
    store.set(messageDeliveryRecordsAtom, [
      staleLocalPeer,
      activeDelivery("returning"),
    ]);

    await returnActiveDeliveryToMessageQueue(store, "returning", returning);

    expect(store.get(messageQueueAtom)).toEqual([returning]);
    expect(store.get(activeMessageDeliveriesAtom)).toEqual([durablePeer]);
  });

  it("preserves a concurrent enqueue while an owner return is pending", async () => {
    const returning = message("returning", {
      conversationDispatch: activeDelivery("returning").conversationDispatch,
      requiresExplicitDispatch: true,
    });
    const concurrent = message("concurrent");
    let release!: () => void;
    mocks.returnToQueue.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ message: returning, active: [] });
        })
    );
    const store = createStore();
    store.set(messageDeliveryRecordsAtom, [activeDelivery("returning")]);

    const restoration = returnActiveDeliveryToMessageQueue(
      store,
      "returning",
      returning
    );
    await vi.waitFor(() => expect(mocks.returnToQueue).toHaveBeenCalledOnce());
    store.set(messageQueueAtom, [concurrent]);
    release();
    await restoration;

    expect(store.get(messageQueueAtom)).toEqual([concurrent, returning]);
    expect(store.get(activeMessageDeliveriesAtom)).toEqual([]);
  });
});

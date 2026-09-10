// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { MobileRemotePlatformProvider } from "../platform";
import { createBrowserMobileRemotePlatform } from "../platform/browser";
import {
  type MobileRemoteContextValue,
  MobileRemoteProviders,
  type MobileRemoteProvidersProps,
  useMobileRemote,
} from "./MobileRemoteProviders";

const TestMobileRemoteProviders = MobileRemoteProviders as React.ComponentType<
  React.PropsWithChildren<Omit<MobileRemoteProvidersProps, "children">>
>;
const TestMobileRemotePlatformProvider =
  MobileRemotePlatformProvider as React.ComponentType<
    React.PropsWithChildren<
      Omit<
        React.ComponentProps<typeof MobileRemotePlatformProvider>,
        "children"
      >
    >
  >;

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  close: vi.fn(),
  notificationHandler: null as
    | ((method: string, params?: Record<string, unknown>) => void)
    | null,
  sendParams: null as Record<string, unknown> | null,
  externalRoundId: null as string | null,
}));

vi.mock("../connection/mobileRpcClient", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../connection/mobileRpcClient")>();
  return {
    ...original,
    createMobileRpcClient: (socket: WebSocket) => ({
      call: mocks.call,
      notify: vi.fn(),
      onNotification: (
        handler: (method: string, params?: Record<string, unknown>) => void
      ) => {
        mocks.notificationHandler = handler;
        return () => {
          if (mocks.notificationHandler === handler) {
            mocks.notificationHandler = null;
          }
        };
      },
      close: () => {
        mocks.close();
        socket.close();
      },
      readyState: 1,
    }),
  };
});

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static deferCloseEvents = false;
  static pendingCloseEvents: FakeWebSocket[] = [];

  static flushCloseEvents() {
    const pending = FakeWebSocket.pendingCloseEvents.splice(0);
    for (const socket of pending) {
      socket.dispatchEvent(new Event("close"));
    }
  }

  readyState = 0;

  constructor(_url: string) {
    super();
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    if (FakeWebSocket.deferCloseEvents) {
      FakeWebSocket.pendingCloseEvents.push(this);
    } else {
      this.dispatchEvent(new Event("close"));
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("MobileRemoteProviders send lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestContext: MobileRemoteContextValue | null;
  let sendResult: ReturnType<typeof deferred<{ execution: string }>>;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  function Probe(): null {
    const context = useMobileRemote();
    React.useEffect(() => {
      latestContext = context;
    }, [context]);
    return null;
  }

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  beforeEach(async () => {
    latestContext = null;
    sendResult = deferred<{ execution: string }>();
    mocks.sendParams = null;
    mocks.externalRoundId = null;
    mocks.notificationHandler = null;
    mocks.close.mockReset();
    FakeWebSocket.instances = [];
    FakeWebSocket.deferCloseEvents = false;
    FakeWebSocket.pendingCloseEvents = [];
    mocks.call
      .mockReset()
      .mockImplementation(
        (method: string, params?: Record<string, unknown>) => {
          if (method === "initialize") {
            return Promise.resolve({ protocolVersion: 1, tier: "full" });
          }
          if (method === "session/list") {
            return Promise.resolve({ sessions: [] });
          }
          if (method === "session/subscribe") {
            const externalRound = mocks.externalRoundId
              ? [
                  {
                    id: mocks.externalRoundId,
                    userPreview: "external turn",
                  },
                ]
              : [];
            return Promise.resolve({
              sessionId: params?.sessionId,
              rounds: {
                items: [
                  { id: "round-1", userPreview: "First" },
                  { id: "round-2", userPreview: "Second" },
                  { id: "round-3", userPreview: "Latest" },
                  ...externalRound,
                ],
                complete: true,
              },
              snapshot: {
                sessionId: params?.sessionId,
                roundId: mocks.externalRoundId ?? "round-3",
                version: 1,
                snapshotDelta: false,
                upserts: [],
              },
            });
          }
          if (method === "session/round") {
            const roundId = String(params?.roundId);
            return Promise.resolve({
              sessionId: params?.sessionId,
              roundId,
              snapshot: {
                sessionId: params?.sessionId,
                roundId,
                version: 1,
                snapshotDelta: false,
                upserts: [
                  {
                    id: `agent-${roundId}`,
                    source: "assistant",
                    displayVariant: "message",
                    displayText: `History ${roundId}`,
                  },
                ],
              },
            });
          }
          if (method === "session/send") {
            mocks.sendParams = params ?? null;
            return sendResult.promise;
          }
          return Promise.resolve({});
        }
      );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(
          TestMobileRemotePlatformProvider,
          { platform: createBrowserMobileRemotePlatform() },
          React.createElement(
            TestMobileRemoteProviders,
            {
              authUserId: "user-a",
              demoByDefault: false,
              suppressInitialBootstrap: true,
            },
            React.createElement(Probe)
          )
        )
      );
    });
    await act(async () => {
      await latestContext?.connectLive({
        wsUrl: "wss://relay.example.test/v1/mobile/ws",
      });
    });
    await act(async () => {
      await latestContext?.subscribeSession("session-a");
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("keeps the browser platform identity in the initialize wire shape", () => {
    expect(mocks.call).toHaveBeenCalledWith("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "orgii-mobile-pwa", version: "0.1.0" },
      capabilities: { interactions: ["permission"], streaming: true },
      deviceLabel: "ORGII Mobile",
    });
  });

  it("observes revocation while the initial roster is still loading", async () => {
    const roster = deferred<{ sessions: never[] }>();
    const original = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((method, params) =>
      method === "session/list" ? roster.promise : original(method, params)
    );
    let connecting: Promise<void> | undefined;
    await act(async () => {
      connecting = latestContext?.connectLive({
        wsUrl: "wss://relay.example.test/v1/mobile/ws",
      });
    });
    const socket = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      socket.readyState = FakeWebSocket.CLOSED;
      socket.dispatchEvent(new CloseEvent("close", { code: 1008 }));
    });
    expect(latestContext?.connection.status).toBe("error");
    await act(async () => {
      roster.resolve({ sessions: [] });
      await connecting;
    });
    expect(latestContext?.connection.status).toBe("error");
  });

  it("keeps the newest desktop choice when configuration reads finish out of order", async () => {
    act(() => root.unmount());
    root = createRoot(container);
    const first = deferred<{ wsUrl: string }>();
    const browser = createBrowserMobileRemotePlatform();
    const platform = {
      ...browser,
      connection: {
        ...browser.connection,
        selectPairedDesktop: vi.fn((_user: string, desktop: string) =>
          desktop === "a"
            ? first.promise
            : Promise.resolve({ wsUrl: "wss://b.example/v1/mobile/ws" })
        ),
      },
    };
    await act(async () =>
      root.render(
        React.createElement(
          TestMobileRemotePlatformProvider,
          { platform },
          React.createElement(
            TestMobileRemoteProviders,
            {
              authUserId: "user-a",
              demoByDefault: false,
              suppressInitialBootstrap: true,
            },
            React.createElement(Probe)
          )
        )
      )
    );
    let a!: Promise<void>;
    await act(async () => {
      a = latestContext!.switchPairedDesktop("a");
    });
    await act(async () => latestContext!.switchPairedDesktop("b"));
    const socketCount = FakeWebSocket.instances.length;
    await act(async () => {
      first.resolve({ wsUrl: "wss://a.example/v1/mobile/ws" });
      await a;
    });
    expect(latestContext!.connectionConfig?.wsUrl).toBe(
      "wss://b.example/v1/mobile/ws"
    );
    expect(FakeWebSocket.instances).toHaveLength(socketCount);
  });

  it("loads additional workspace rows, preserves the loaded window on refresh and retains it on failure", async () => {
    mocks.call.mockImplementation((method, params) => {
      if (method !== "session/list") return Promise.resolve({});
      const offset = Number(params?.offset ?? 0);
      return Promise.resolve({
        sessions: [
          {
            id: `row-${offset}`,
            name: "Row",
            status: "idle",
            repoPath: `/workspace/${offset}`,
            updatedAtMs: offset,
          },
        ],
        nextOffset: offset + 50,
        hasMore: offset === 0,
      });
    });
    await act(async () => {
      await latestContext!.refreshSessions();
    });
    expect(latestContext!.sessionsHasMore).toBe(true);
    await act(async () => {
      await latestContext!.loadMoreSessions();
    });
    expect(latestContext!.sessions.map((row) => row.repoPath)).toEqual([
      "/workspace/0",
      "/workspace/50",
    ]);
    await act(async () => {
      await latestContext!.refreshSessions();
    });
    expect(latestContext!.sessions).toHaveLength(2);
    mocks.call.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await expect(latestContext!.refreshSessions()).rejects.toThrow("offline");
    });
    expect(latestContext!.sessions).toHaveLength(2);
  });

  it("renders the user message before the send RPC is acknowledged and deduplicates its echo", async () => {
    let pendingSend!: Promise<void>;
    await act(async () => {
      pendingSend = latestContext!.sendMessage("session-a", "visible now");
      await Promise.resolve();
    });

    expect(latestContext?.transcriptItems).toEqual([
      expect.objectContaining({
        kind: "user",
        text: "visible now",
        optimistic: true,
      }),
    ]);
    const turnIntentId = String(mocks.sendParams?.turnIntentId);
    expect(mocks.sendParams).toEqual({
      sessionId: "session-a",
      content: "visible now",
      turnIntentId,
      turnIntentSource: "mobile_remote",
      attachments: [],
    });

    await act(async () => {
      sendResult.resolve({ execution: "native_agent" });
      await pendingSend;
    });
    act(() => {
      mocks.notificationHandler?.("orgii/snapshot", {
        sessionId: "session-a",
        version: 2,
        snapshotDelta: true,
        upserts: [
          {
            id: "persisted-user",
            turnIntentId,
            source: "user",
            displayVariant: "message",
            displayText: "visible now",
          },
        ],
      });
    });

    expect(latestContext?.transcriptItems).toEqual([
      expect.objectContaining({
        id: "persisted-user",
        text: "visible now",
      }),
    ]);
    expect(latestContext?.transcriptItems.some((item) => item.optimistic)).toBe(
      false
    );
  });

  it("keeps the pending mobile question before an agent response that races ahead of its echo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
    try {
      let pendingSend!: Promise<void>;
      await act(async () => {
        pendingSend = latestContext!.sendMessage("session-a", "question first");
        await Promise.resolve();
      });

      vi.setSystemTime(new Date("2026-08-30T12:00:01.000Z"));
      act(() => {
        mocks.notificationHandler?.("orgii/snapshot", {
          sessionId: "session-a",
          version: 2,
          snapshotDelta: true,
          upserts: [
            {
              id: "agent-response",
              source: "assistant",
              displayVariant: "message",
              displayText: "answer second",
              createdAt: "2026-08-30T12:00:01.000Z",
            },
          ],
        });
      });

      expect(latestContext?.transcriptItems).toEqual([
        expect.objectContaining({
          kind: "user",
          text: "question first",
          optimistic: true,
        }),
        expect.objectContaining({
          kind: "agent",
          text: "answer second",
        }),
      ]);

      await act(async () => {
        sendResult.resolve({ execution: "managed_cli" });
        await pendingSend;
      });
      const turnIntentId = String(mocks.sendParams?.turnIntentId);
      act(() => {
        mocks.notificationHandler?.("orgii/snapshot", {
          sessionId: "session-a",
          version: 3,
          snapshotDelta: true,
          upserts: [
            {
              id: "persisted-user",
              turnIntentId,
              source: "user",
              displayVariant: "message",
              displayText: "question first",
              createdAt: "2026-08-30T12:00:00.100Z",
            },
          ],
        });
      });

      expect(latestContext?.transcriptItems.map((item) => item.id)).toEqual([
        "persisted-user",
        "agent-response",
      ]);
      expect(
        latestContext?.transcriptItems.some((item) => item.optimistic)
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a late send failure after leaving and reopening the same session", async () => {
    let oldSend!: Promise<void>;
    const oldResult = sendResult;
    await act(async () => {
      oldSend = latestContext!.sendMessage("session-a", "old message");
      void oldSend.catch(() => undefined);
    });
    await act(async () => {
      await latestContext!.unsubscribeSession();
      await latestContext!.subscribeSession("session-a");
    });
    sendResult = deferred<{ execution: string }>();
    let newSend!: Promise<void>;
    await act(async () => {
      newSend = latestContext!.sendMessage("session-a", "new message");
    });
    const currentStatus = latestContext!.sendStatus;
    const currentItems = latestContext!.transcriptItems;
    await act(async () => {
      oldResult.reject(new Error("Relay rejected the old message"));
      await expect(oldSend).resolves.toBeUndefined();
    });
    expect(latestContext!.sendStatus).toEqual(currentStatus);
    expect(latestContext!.transcriptItems).toEqual(currentItems);
    expect(latestContext!.sendStatus?.phase).toBe("submitting");
    await act(async () => {
      sendResult.resolve({ execution: "native_agent" });
      await newSend;
    });
    expect(latestContext!.sendStatus?.phase).toBe("accepted");
  });

  it("removes the optimistic row when dispatch fails", async () => {
    let pendingSend!: Promise<void>;
    await act(async () => {
      pendingSend = latestContext!.sendMessage("session-a", "retry me");
      void pendingSend.catch(() => undefined);
      await Promise.resolve();
    });
    expect(latestContext?.transcriptItems).toHaveLength(1);
    const turnIntentId = String(mocks.sendParams?.turnIntentId);

    act(() => {
      mocks.notificationHandler?.("orgii/snapshot", {
        sessionId: "session-a",
        version: 2,
        snapshotDelta: true,
        upserts: [
          {
            id: "failed-user-echo",
            turnIntentId,
            source: "user",
            displayVariant: "message",
            displayText: "retry me",
          },
        ],
      });
    });
    expect(latestContext?.transcriptItems).toEqual([
      expect.objectContaining({ id: "failed-user-echo" }),
    ]);
    expect(latestContext?.transcriptItems[0]).not.toHaveProperty("optimistic");

    await act(async () => {
      sendResult.reject(new Error("Relay rejected the message"));
      await expect(pendingSend).rejects.toThrow("Relay rejected the message");
    });

    expect(latestContext?.transcriptItems).toEqual([]);
    expect(latestContext?.activeRoundId).toBe("round-3");
    expect(latestContext?.transcriptRounds).toHaveLength(3);
    expect(latestContext?.sendStatus).toMatchObject({
      phase: "failed",
      message: "Relay rejected the message",
    });
  });

  it("returns after an external Codex acknowledgement when its terminal notification is lost", async () => {
    let pendingSend!: Promise<void>;
    await act(async () => {
      pendingSend = latestContext!.sendMessage("session-a", "do not hang");
      await Promise.resolve();
    });

    await act(async () => {
      sendResult.resolve({ execution: "external_codex" });
      await pendingSend;
    });

    expect(latestContext?.sendStatus).toMatchObject({
      phase: "accepted",
      sessionId: "session-a",
    });
    expect(latestContext?.transcriptItems.at(-1)).toMatchObject({
      text: "do not hang",
      optimistic: true,
    });
  });

  it("keeps an external provisional round when completion has no proven round id", async () => {
    let pendingSend!: Promise<void>;
    await act(async () => {
      pendingSend = latestContext!.sendMessage("session-a", "external turn");
      await Promise.resolve();
    });
    const turnIntentId = String(mocks.sendParams?.turnIntentId);
    await act(async () => {
      sendResult.resolve({ execution: "external_codex" });
      await pendingSend;
    });
    expect(latestContext?.transcriptItems.at(-1)).toMatchObject({
      text: "external turn",
      optimistic: true,
    });

    act(() => {
      mocks.notificationHandler?.("session/send_status", {
        sessionId: "session-a",
        turnIntentId,
        status: "completed",
      });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latestContext?.sendStatus).toMatchObject({
      phase: "completed",
      turnIntentId,
    });
    expect(latestContext?.activeRoundId).toBe(`local-pending:${turnIntentId}`);
    expect(latestContext?.transcriptItems.at(-1)).toMatchObject({
      text: "external turn",
      optimistic: true,
    });
  });

  it("promotes an external provisional round from an exact terminal round id", async () => {
    let pendingSend!: Promise<void>;
    await act(async () => {
      pendingSend = latestContext!.sendMessage("session-a", "external turn");
      await Promise.resolve();
    });
    const turnIntentId = String(mocks.sendParams?.turnIntentId);
    await act(async () => {
      sendResult.resolve({ execution: "external_codex" });
      await pendingSend;
    });
    mocks.externalRoundId = "codex-user-42";

    act(() => {
      mocks.notificationHandler?.("session/send_status", {
        sessionId: "session-a",
        turnIntentId,
        status: "completed",
        roundId: mocks.externalRoundId,
      });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latestContext?.sendStatus).toMatchObject({
      phase: "completed",
      turnIntentId,
    });
    expect(latestContext?.activeRoundId).toBe("codex-user-42");
    expect(latestContext?.transcriptRounds.map((round) => round.id)).toEqual([
      "round-1",
      "round-2",
      "round-3",
      "codex-user-42",
    ]);
    expect(latestContext?.transcriptItems.at(-1)).toMatchObject({
      text: "external turn",
    });
  });

  it("keeps an accepted question when transport loss makes dispatch uncertain", async () => {
    let pendingSend!: Promise<void>;
    await act(async () => {
      pendingSend = latestContext!.sendMessage(
        "session-a",
        "survive reconnect"
      );
      void pendingSend.catch(() => undefined);
      await Promise.resolve();
    });

    await act(async () => {
      sendResult.reject(new Error("WebSocket closed"));
      await pendingSend;
    });

    expect(latestContext?.sendStatus).toMatchObject({ phase: "uncertain" });
    expect(latestContext?.transcriptItems.at(-1)).toMatchObject({
      text: "survive reconnect",
      optimistic: true,
    });
  });

  it("keeps session lifecycle callbacks stable across presence changes", () => {
    const initialSubscribe = latestContext?.subscribeSession;
    const initialUnsubscribe = latestContext?.unsubscribeSession;

    act(() => {
      mocks.notificationHandler?.("relay/presence", { online: false });
    });
    act(() => {
      mocks.notificationHandler?.("relay/presence", { online: true });
    });

    expect(latestContext?.subscribeSession).toBe(initialSubscribe);
    expect(latestContext?.unsubscribeSession).toBe(initialUnsubscribe);
  });

  it("releases the socket while hidden and reconnects only once when visible", async () => {
    let documentHidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => documentHidden,
    });

    try {
      const initialSocket = FakeWebSocket.instances[0];
      expect(initialSocket?.readyState).toBe(FakeWebSocket.OPEN);

      FakeWebSocket.deferCloseEvents = true;
      documentHidden = true;
      act(() => document.dispatchEvent(new Event("visibilitychange")));

      expect(initialSocket?.readyState).toBe(FakeWebSocket.CLOSED);
      expect(latestContext?.connection.presence).toBe("offline");

      documentHidden = false;
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(FakeWebSocket.instances[1]?.readyState).toBe(FakeWebSocket.OPEN);

      await act(async () => {
        FakeWebSocket.flushCloseEvents();
        await Promise.resolve();
      });
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(FakeWebSocket.instances[1]?.readyState).toBe(FakeWebSocket.OPEN);

      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
      });
      expect(FakeWebSocket.instances).toHaveLength(2);
    } finally {
      FakeWebSocket.deferCloseEvents = false;
      FakeWebSocket.flushCloseEvents();
      Reflect.deleteProperty(document, "hidden");
    }
  });

  it("stops automatic reconnect after a device-revoked close, including focus return", async () => {
    const socket = FakeWebSocket.instances[0];
    await act(async () => {
      socket.readyState = FakeWebSocket.CLOSED;
      socket.dispatchEvent(new CloseEvent("close", { code: 1008 }));
    });
    expect(latestContext?.connection.status).toBe("error");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("never opens a socket from a late ticket after disconnect or account switch", async () => {
    act(() => root.unmount());
    root = createRoot(container);
    latestContext = null;
    FakeWebSocket.instances = [];
    const prepared = deferred<string>();
    const browser = createBrowserMobileRemotePlatform();
    let signal: AbortSignal | undefined;
    const prepareSocketUrl = vi.fn((_config, context) => {
      signal = context.signal;
      return prepared.promise;
    });
    const platform = {
      ...browser,
      connection: { ...browser.connection, prepareSocketUrl },
    };
    const render = (authUserId: string) =>
      root.render(
        React.createElement(
          TestMobileRemotePlatformProvider,
          { platform },
          React.createElement(
            TestMobileRemoteProviders,
            {
              authUserId,
              demoByDefault: false,
              suppressInitialBootstrap: true,
            },
            React.createElement(Probe)
          )
        )
      );
    await act(async () => render("user-a"));
    let connecting: Promise<void> | undefined;
    await act(async () => {
      connecting = latestContext?.connectLive({
        wsUrl: "wss://relay.example/v1/mobile/ws",
      });
      await Promise.resolve();
    });
    expect(prepareSocketUrl).toHaveBeenCalledTimes(1);
    await act(async () => {
      latestContext?.disconnect();
      render("user-b");
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      prepared.resolve("wss://relay.example/v1/mobile/ws?ticket=stale");
      await expect(connecting).rejects.toThrow();
    });
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(
      (latestContext as MobileRemoteContextValue | null)?.connection.status
    ).not.toBe("connected");
  });

  it("does not let a slow bootstrap load replace an explicit connection", async () => {
    act(() => root.unmount());
    root = createRoot(container);
    latestContext = null;
    FakeWebSocket.instances = [];

    const bootstrap = deferred<{
      wsUrl: string;
      deviceToken: string;
    } | null>();
    const browserPlatform = createBrowserMobileRemotePlatform();
    const load = vi.fn(() => bootstrap.promise);
    const save = vi.fn().mockResolvedValue(undefined);
    const platform = {
      ...browserPlatform,
      connection: {
        ...browserPlatform.connection,
        load,
        save,
      },
    };

    await act(async () => {
      root.render(
        React.createElement(
          TestMobileRemotePlatformProvider,
          { platform },
          React.createElement(
            TestMobileRemoteProviders,
            { authUserId: "user-a", demoByDefault: false },
            React.createElement(Probe)
          )
        )
      );
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledWith("user-a");

    const explicitConfig = {
      wsUrl: "wss://new.example.test/v1/mobile/ws",
      deviceToken: "new-device-token",
    };
    await act(async () => {
      await latestContext?.connectLive(explicitConfig);
    });

    await act(async () => {
      bootstrap.resolve({
        wsUrl: "wss://stale.example.test/v1/mobile/ws",
        deviceToken: "stale-device-token",
      });
      await bootstrap.promise;
      await Promise.resolve();
    });

    expect(
      (latestContext as MobileRemoteContextValue | null)?.connectionConfig
    ).toEqual(explicitConfig);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("user-a", explicitConfig);
  });

  it("serializes connection persistence so the latest disconnect wins", async () => {
    act(() => root.unmount());
    root = createRoot(container);
    latestContext = null;

    const firstSave = deferred<void>();
    const secondSave = deferred<void>();
    const browserPlatform = createBrowserMobileRemotePlatform();
    const save = vi
      .fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const platform = {
      ...browserPlatform,
      connection: {
        ...browserPlatform.connection,
        save,
      },
    };

    await act(async () => {
      root.render(
        React.createElement(
          TestMobileRemotePlatformProvider,
          { platform },
          React.createElement(
            TestMobileRemoteProviders,
            {
              authUserId: "user-a",
              demoByDefault: false,
              suppressInitialBootstrap: true,
            },
            React.createElement(Probe)
          )
        )
      );
      await Promise.resolve();
    });

    const config = {
      wsUrl: "wss://relay.example.test/v1/mobile/ws",
      deviceToken: "device-token",
    };
    let connectPromise!: Promise<void>;
    let disconnectPromise!: Promise<void>;
    await act(async () => {
      connectPromise = latestContext!.connectLive(config);
      void connectPromise.catch(() => undefined);
      await Promise.resolve();
      disconnectPromise = latestContext!.disconnect();
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, "user-a", config);

    await act(async () => {
      firstSave.resolve();
      await firstSave.promise;
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, "user-a", null);

    await act(async () => {
      secondSave.resolve();
      await secondSave.promise;
      await disconnectPromise;
    });
    await expect(connectPromise).rejects.toThrow("Connection was superseded");
    expect(
      (latestContext as MobileRemoteContextValue | null)?.connectionConfig
    ).toBeNull();
  });

  it("fails closed to read-only when initialize omits the access tier", async () => {
    act(() => root.unmount());
    root = createRoot(container);
    latestContext = null;
    mocks.call.mockImplementation(
      (method: string, params?: Record<string, unknown>) => {
        if (method === "initialize") {
          return Promise.resolve({ protocolVersion: 1 });
        }
        if (method === "session/list") {
          return Promise.resolve({ sessions: [] });
        }
        return Promise.resolve({ sessionId: params?.sessionId });
      }
    );

    await act(async () => {
      root.render(
        React.createElement(
          TestMobileRemotePlatformProvider,
          { platform: createBrowserMobileRemotePlatform() },
          React.createElement(
            TestMobileRemoteProviders,
            {
              authUserId: "user-a",
              demoByDefault: false,
              suppressInitialBootstrap: true,
            },
            React.createElement(Probe)
          )
        )
      );
      await Promise.resolve();
    });
    await act(async () => {
      await latestContext?.connectLive({
        wsUrl: "wss://relay.example.test/v1/mobile/ws",
      });
    });

    expect(
      (latestContext as MobileRemoteContextValue | null)?.connection
    ).toMatchObject({
      status: "connected",
      presence: "online",
      tier: "read_only",
    });
  });

  it.each([
    {
      name: "CLI status",
      envelope: (turnIntentId: string) => ({
        type: "code_session.status_changed",
        session_id: "session-a",
        turn_intent_id: turnIntentId,
        status: "completed",
      }),
    },
    {
      name: "streaming completion",
      envelope: (turnIntentId: string) => ({
        type: "agent:streaming_complete",
        payload: {
          sessionId: "session-a",
          event: { result: { turnIntentId } },
        },
      }),
    },
    {
      name: "history invalidation",
      envelope: (turnIntentId: string) => ({
        type: "code_session.history_changed",
        session_id: "session-a",
        history_session_id: "cursorcliapp-history",
        status: "turn_settled",
        turn_intent_id: turnIntentId,
      }),
    },
  ])(
    "settles the managed send and refreshes history on $name",
    async ({ envelope }) => {
      let pendingSend!: Promise<void>;
      await act(async () => {
        pendingSend = latestContext!.sendMessage("session-a", "managed turn");
        await Promise.resolve();
      });
      const turnIntentId = String(mocks.sendParams?.turnIntentId);
      await act(async () => {
        sendResult.resolve({ execution: "managed_cli" });
        await pendingSend;
      });
      expect(latestContext?.sendStatus?.phase).toBe("accepted");
      const subscribeCallsBefore = mocks.call.mock.calls.filter(
        ([method]) => method === "session/subscribe"
      ).length;

      act(() => {
        mocks.notificationHandler?.("orgii/event", {
          sessionId: "session-a",
          envelope: envelope(turnIntentId),
        });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestContext?.sendStatus).toMatchObject({
        phase: "completed",
        turnIntentId,
      });
      expect(
        mocks.call.mock.calls.filter(
          ([method]) => method === "session/subscribe"
        )
      ).toHaveLength(subscribeCallsBefore + 1);
    }
  );

  it("does not settle the current send from another turn's terminal event", async () => {
    let pendingSend!: Promise<void>;
    await act(async () => {
      pendingSend = latestContext!.sendMessage("session-a", "current turn");
      await Promise.resolve();
    });
    await act(async () => {
      sendResult.resolve({ execution: "managed_cli" });
      await pendingSend;
    });

    act(() => {
      mocks.notificationHandler?.("orgii/event", {
        sessionId: "session-a",
        envelope: {
          type: "code_session.status_changed",
          session_id: "session-a",
          turn_intent_id: "another-turn",
          status: "completed",
        },
      });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latestContext?.sendStatus).toMatchObject({
      phase: "accepted",
      turnIntentId: mocks.sendParams?.turnIntentId,
    });
  });

  it("ignores a pending subscription failure after transport revocation", async () => {
    const result = deferred<unknown>();
    mocks.call.mockImplementationOnce(() => result.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = latestContext!.subscribeSession("session-b");
      void pending.catch(() => undefined);
    });
    act(() => {
      FakeWebSocket.instances
        .at(-1)!
        .dispatchEvent(new CloseEvent("close", { code: 1008 }));
    });
    const phase = latestContext!.transcriptPhase;
    await act(async () => {
      result.reject(new Error("late subscribe failure"));
      await expect(pending).resolves.toBeUndefined();
    });
    expect(latestContext!.connection.status).toBe("error");
    expect(latestContext!.transcriptPhase).toBe(phase);
    expect(latestContext!.transcriptError).not.toBe("late subscribe failure");
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a late historical round %s after transport revocation",
    async (outcome) => {
      const result = deferred<unknown>();
      mocks.call.mockImplementationOnce(() => result.promise);
      act(() => latestContext!.selectRound("round-1"));
      expect(mocks.call).toHaveBeenLastCalledWith("session/round", {
        sessionId: "session-a",
        roundId: "round-1",
      });
      act(() => {
        FakeWebSocket.instances
          .at(-1)!
          .dispatchEvent(new CloseEvent("close", { code: 1008 }));
      });
      const phase = latestContext!.transcriptPhase;
      const items = latestContext!.transcriptItems;
      await act(async () => {
        if (outcome === "reject")
          result.reject(new Error("late round failure"));
        else
          result.resolve({
            sessionId: "session-a",
            roundId: "round-1",
            snapshot: {
              sessionId: "session-a",
              roundId: "round-1",
              version: 1,
              snapshotDelta: false,
              upserts: [
                {
                  id: "late",
                  source: "assistant",
                  displayVariant: "message",
                  displayText: "stale history",
                },
              ],
            },
          });
        await Promise.resolve();
      });
      expect(latestContext!.transcriptPhase).toBe(phase);
      expect(latestContext!.transcriptItems).toEqual(items);
      expect(latestContext!.transcriptError).not.toBe("late round failure");
    }
  );

  it("loads a selected historical round through session/round", async () => {
    act(() => latestContext?.selectRound("round-1"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.call).toHaveBeenCalledWith("session/round", {
      sessionId: "session-a",
      roundId: "round-1",
    });
    expect(latestContext).toMatchObject({
      selectedRoundId: "round-1",
      activeRoundId: "round-1",
      transcriptPhase: "ready",
    });
    expect(latestContext?.transcriptItems).toEqual([
      expect.objectContaining({ text: "History round-1" }),
    ]);
  });

  it("opens only the event-owned file target in the paired Desktop", async () => {
    await act(async () => {
      await latestContext?.openSessionFileInDesktop(
        "session-a",
        "round-2",
        "event-edit-1",
        1
      );
    });

    expect(mocks.call).toHaveBeenCalledWith("session/open_file", {
      sessionId: "session-a",
      roundId: "round-2",
      eventId: "event-edit-1",
      targetIndex: 1,
    });
  });

  it("refreshes the round index after a settled live delta", async () => {
    const subscribeCallsBefore = mocks.call.mock.calls.filter(
      ([method]) => method === "session/subscribe"
    ).length;
    act(() => {
      mocks.notificationHandler?.("orgii/snapshot", {
        sessionId: "session-a",
        version: 2,
        snapshotDelta: true,
        streaming: false,
        upserts: [
          {
            id: "settled-agent",
            source: "assistant",
            displayVariant: "message",
            displayText: "Settled",
          },
        ],
      });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      mocks.call.mock.calls.filter(([method]) => method === "session/subscribe")
    ).toHaveLength(subscribeCallsBefore + 1);
  });

  it("moves a send from an older round back to follow-latest", async () => {
    act(() => latestContext?.selectRound("round-1"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    let pendingSend!: Promise<void>;
    await act(async () => {
      pendingSend = latestContext!.sendMessage("session-a", "new latest turn");
      await Promise.resolve();
    });

    expect(latestContext?.selectedRoundId).toBeNull();
    expect(latestContext?.activeRoundId).toBe(
      `local-pending:${String(mocks.sendParams?.turnIntentId)}`
    );
    expect(latestContext?.transcriptRounds.map((round) => round.id)).toEqual([
      "round-1",
      "round-2",
      "round-3",
      `local-pending:${String(mocks.sendParams?.turnIntentId)}`,
    ]);
    expect(latestContext?.transcriptItems.at(-1)).toMatchObject({
      text: "new latest turn",
      optimistic: true,
    });

    await act(async () => {
      sendResult.resolve({ execution: "native_agent" });
      await pendingSend;
    });
  });
  describe("permission prompts", () => {
    /** Flat wire event: no `payload` wrapper, `origin` on the envelope. */
    function flatPermissionEnvelope(
      requestId: string,
      origin: "cli_hook" | "acp" = "cli_hook",
      sessionId = "session-a"
    ) {
      return {
        type: "permission:request",
        session_id: sessionId,
        sessionId,
        requestId,
        toolName: "Bash",
        toolCallId: requestId,
        toolArgs: { command: "pnpm test" },
        origin,
      };
    }

    function emitPermission(envelope: Record<string, unknown>) {
      act(() => {
        mocks.notificationHandler?.("orgii/event", {
          channel: "bus",
          sessionId: envelope.sessionId,
          envelope,
        });
      });
    }

    function respondCalls() {
      return mocks.call.mock.calls.filter(
        ([method]) => method === "interaction/respond_permission"
      );
    }

    it.each(["cli_hook", "acp"] as const)(
      "surfaces a flat %s prompt and answers it with its origin",
      async (origin) => {
        emitPermission(flatPermissionEnvelope("perm-flat", origin));

        expect(latestContext?.activePermission).toMatchObject({
          requestId: "perm-flat",
          sessionId: "session-a",
          toolName: "Bash",
          origin,
        });

        await act(async () => {
          await latestContext!.respondPermission("allow");
        });

        expect(respondCalls()).toEqual([
          [
            "interaction/respond_permission",
            {
              sessionId: "session-a",
              requestId: "perm-flat",
              response: "allow",
              origin,
            },
          ],
        ]);
        expect(latestContext?.activePermission).toBeNull();
      }
    );

    it("answers a wrapped native prompt as rust_agent", async () => {
      emitPermission({
        type: "permission:request",
        payload: {
          sessionId: "session-a",
          requestId: "perm-native",
          toolName: "run_shell",
          toolCallId: "call-native",
          toolArgs: {},
        },
      });

      await act(async () => {
        await latestContext!.respondPermission("deny");
      });

      expect(respondCalls()[0]?.[1]).toMatchObject({
        requestId: "perm-native",
        response: "deny",
        origin: "rust_agent",
      });
    });

    it("ignores a second tap while the first answer is in flight", async () => {
      const respondResult = deferred<{ accepted: boolean }>();
      const baseCall = mocks.call.getMockImplementation()!;
      mocks.call.mockImplementation(
        (method: string, params?: Record<string, unknown>) =>
          method === "interaction/respond_permission"
            ? respondResult.promise
            : baseCall(method, params)
      );

      emitPermission(flatPermissionEnvelope("hookperm-1"));
      emitPermission(flatPermissionEnvelope("hookperm-2"));
      expect(latestContext?.permissionQueueDepth).toBe(2);

      // One button, two taps: both use the callback rendered for the head.
      const respond = latestContext!.respondPermission;
      let first!: Promise<void>;
      let second!: Promise<void>;
      await act(async () => {
        first = respond("allow");
        second = respond("allow");
        await Promise.resolve();
      });

      expect(respondCalls()).toHaveLength(1);
      expect(latestContext?.permissionSubmitting).toBe(true);
      await act(async () => {
        await second;
      });
      expect(latestContext?.permissionQueueDepth).toBe(2);

      await act(async () => {
        respondResult.resolve({ accepted: true });
        await first;
      });

      expect(respondCalls()).toHaveLength(1);
      expect(latestContext?.permissionQueueDepth).toBe(1);
      expect(latestContext?.activePermission?.requestId).toBe("hookperm-2");
      expect(latestContext?.permissionSubmitting).toBe(false);
    });

    it("does not let an old desktop response dequeue or unlock a new desktop prompt", async () => {
      const oldReply = deferred<{ accepted: boolean }>();
      const newReply = deferred<{ accepted: boolean }>();
      const baseCall = mocks.call.getMockImplementation()!;
      let answers = 0;
      mocks.call.mockImplementation((method, params) =>
        method === "interaction/respond_permission"
          ? ++answers === 1
            ? oldReply.promise
            : newReply.promise
          : baseCall(method, params)
      );
      emitPermission(flatPermissionEnvelope("same-id"));
      let oldRequest!: Promise<void>;
      await act(async () => {
        oldRequest = latestContext!.respondPermission("allow");
      });
      await act(async () =>
        latestContext!.connectLive({
          wsUrl: "wss://new-desktop.example/v1/mobile/ws",
        })
      );
      expect(latestContext?.activePermission).toBeNull();
      expect(latestContext?.permissionSubmitting).toBe(false);
      emitPermission(flatPermissionEnvelope("same-id"));
      let newRequest!: Promise<void>;
      await act(async () => {
        newRequest = latestContext!.respondPermission("deny");
      });
      await act(async () => {
        oldReply.resolve({ accepted: true });
        await oldRequest;
      });
      expect(latestContext?.activePermission?.requestId).toBe("same-id");
      expect(latestContext?.permissionSubmitting).toBe(true);
      await act(async () => {
        newReply.resolve({ accepted: true });
        await newRequest;
      });
      expect(latestContext?.activePermission).toBeNull();
      expect(latestContext?.permissionSubmitting).toBe(false);
    });

    it("keeps a prompt queued when its answer fails", async () => {
      const respondResult = deferred<{ accepted: boolean }>();
      const baseCall = mocks.call.getMockImplementation()!;
      mocks.call.mockImplementation(
        (method: string, params?: Record<string, unknown>) =>
          method === "interaction/respond_permission"
            ? respondResult.promise
            : baseCall(method, params)
      );
      emitPermission(flatPermissionEnvelope("hookperm-retry"));

      let pending!: Promise<void>;
      await act(async () => {
        pending = latestContext!.respondPermission("allow");
        void pending.catch(() => undefined);
        await Promise.resolve();
      });
      await act(async () => {
        respondResult.reject(new Error("Relay rejected the answer"));
        await expect(pending).rejects.toThrow("Relay rejected the answer");
      });

      expect(latestContext?.permissionSubmitting).toBe(false);
      expect(latestContext?.activePermission?.requestId).toBe("hookperm-retry");
    });

    it("hides a prompt raised for another session and dismisses a stale head", () => {
      emitPermission(
        flatPermissionEnvelope("hookperm-other", "cli_hook", "session-b")
      );
      expect(latestContext?.activePermission).toBeNull();

      emitPermission(flatPermissionEnvelope("hookperm-mine"));
      expect(latestContext?.activePermission?.requestId).toBe("hookperm-mine");
      expect(latestContext?.permissionQueueDepth).toBe(1);

      act(() => latestContext?.dismissPermissionHead());
      expect(latestContext?.activePermission).toBeNull();
      expect(respondCalls()).toEqual([]);
    });

    it("drops a native prompt the desktop finalized", () => {
      emitPermission({
        type: "permission:request",
        payload: {
          sessionId: "session-a",
          requestId: "perm-native",
          toolName: "run_shell",
          toolCallId: "call-native",
          toolArgs: {},
        },
      });
      expect(latestContext?.activePermission).not.toBeNull();

      act(() => {
        mocks.notificationHandler?.("orgii/event", {
          channel: "bus",
          sessionId: "session-a",
          envelope: {
            type: "agent:interaction_finalized",
            payload: {
              sessionId: "session-a",
              toolCallId: "call-native",
              tool: "run_shell",
              status: "answered",
            },
          },
        });
      });

      expect(latestContext?.activePermission).toBeNull();
    });
  });
});

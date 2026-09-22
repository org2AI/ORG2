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

import { MobileComposerDraftContext } from "../components/composer/MobileComposerDraftContext";
import { mobileComposerDesktopScope } from "../components/composer/mobileComposerDraftStore";
import type { MobileComposerDraftStore } from "../components/composer/mobileComposerDraftStore";
import { loadScopedMobileConnectionConfig } from "../connection/mobileConnectionStorage";
import type { MobileConnectionConfig } from "../connection/types";
import {
  MobileConnectionAuthorizationError,
  MobileConnectionTicketError,
} from "../connection/types";
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
    createMobileRpcClient: (socket: WebSocket) => {
      const subscribers = new Set<
        (method: string, params?: Record<string, unknown>) => void
      >();
      const notify = (method: string, params?: Record<string, unknown>) => {
        for (const handler of subscribers) handler(method, params);
      };
      mocks.notificationHandler = notify;
      return {
        call: mocks.call,
        notify: vi.fn(),
        onNotification: (
          handler: (method: string, params?: Record<string, unknown>) => void
        ) => {
          subscribers.add(handler);
          return () => {
            subscribers.delete(handler);
          };
        },
        close: () => {
          mocks.close();
          subscribers.clear();
          if (mocks.notificationHandler === notify)
            mocks.notificationHandler = null;
          socket.close();
        },
        readyState: 1,
      };
    },
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
  let latestDraftStore: MobileComposerDraftStore | null;
  let sendResult: ReturnType<typeof deferred<{ execution: string }>>;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  function Probe(): null {
    const context = useMobileRemote();
    const drafts = React.useContext(MobileComposerDraftContext);
    React.useEffect(() => {
      latestContext = context;
      latestDraftStore = drafts;
    }, [context, drafts]);
    return null;
  }

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  beforeEach(async () => {
    latestContext = null;
    latestDraftStore = null;
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

  it("ignores a late opening and closes only its lease after switching chats", async () => {
    const old = deferred<unknown>();
    const base = mocks.call.getMockImplementation()!;
    const reply = (params?: Record<string, unknown>) => ({
      sessionId: params?.sessionId,
      managed: false,
      subscriptionId: params?.subscriptionId,
      rounds: { items: [], complete: true },
      snapshot: {
        sessionId: params?.sessionId,
        upserts: [],
        snapshotDelta: false,
        version: 1,
      },
    });
    let oldParams: Record<string, unknown> | undefined;
    mocks.call.mockImplementation(
      (method: string, params?: Record<string, unknown>) => {
        if (method === "initialize")
          return Promise.resolve({
            protocolVersion: 1,
            tier: "full",
            capabilities: { sessionOpen: true },
          });
        if (method === "session/open") {
          if (params?.sessionId === "old") {
            oldParams = params;
            return old.promise;
          }
          return Promise.resolve(reply(params));
        }
        return base(method, params);
      }
    );
    await act(async () => {
      await latestContext!.connectLive({
        wsUrl: "wss://relay.example.test/v1/mobile/ws",
      });
    });
    mocks.call.mockClear();
    let first!: Promise<void>;
    await act(async () => {
      first = latestContext!.subscribeSession("old");
    });
    await act(async () => {
      for (let i = 0; i < 10; i++)
        mocks.notificationHandler!("session/list_changed", {});
    });
    expect(
      mocks.call.mock.calls.filter(([method]) => method === "session/open")
    ).toHaveLength(1);
    await act(async () => {
      await latestContext!.subscribeSession("new");
    });
    await act(async () => {
      old.resolve(reply(oldParams));
      await first;
    });
    expect(latestContext!.openedSession?.sessionId).toBe("new");
    expect(latestContext!.transcriptSessionId).toBe("new");
    expect(mocks.call).toHaveBeenCalledWith("session/unsubscribe", {
      subscriptionId: oldParams!.subscriptionId,
    });
    // Replacing this connection with a legacy Desktop must not let its old
    // lease suppress the new connection's session-id unsubscribe.
    mocks.call.mockImplementation(
      (method: string, params?: Record<string, unknown>) => {
        if (method === "initialize")
          return Promise.resolve({ protocolVersion: 1, tier: "full" });
        return base(method, params);
      }
    );
    await act(async () => {
      await latestContext!.connectLive({
        wsUrl: "wss://relay.example.test/v1/mobile/ws",
      });
    });
    await act(async () => {
      await latestContext!.unsubscribeSession();
    });
    expect(mocks.call).toHaveBeenCalledWith("session/unsubscribe", {
      sessionId: "new",
    });
  });

  it("combined opening owns canonical history, independent models, and a lease close", async () => {
    const permission = deferred<unknown>();
    const base = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(
      (method: string, params?: Record<string, unknown>) => {
        if (method === "initialize")
          return Promise.resolve({
            protocolVersion: 1,
            tier: "full",
            capabilities: { sessionOpen: true, pendingInteractions: true },
          });
        if (method === "session/open")
          return Promise.resolve({
            sessionId:
              params?.sessionId === "mirror" ? "owner" : params?.sessionId,
            managed: params?.sessionId === "mirror",
            subscriptionId: params?.subscriptionId,
            rounds: { items: [], complete: true },
            snapshot: {
              sessionId:
                params?.sessionId === "mirror" ? "owner" : params?.sessionId,
              upserts: [],
              snapshotDelta: false,
              version: 1,
            },
          });
        if (method === "interaction/pending" && params?.sessionId === "owner")
          return permission.promise;
        if (method === "session/config")
          return Promise.resolve({
            sessionId: params?.sessionId,
            model: "current",
            modelEditable: true,
          });
        return base(method, params);
      }
    );
    await act(async () => {
      await latestContext!.connectLive({
        wsUrl: "wss://relay.example.test/v1/mobile/ws",
      });
    });
    mocks.call.mockClear();
    let opening!: Promise<void>;
    await act(async () => {
      opening = latestContext!.subscribeSession("mirror");
    });
    expect(latestContext!.openedSession).toEqual({
      requested: "mirror",
      sessionId: "owner",
      managed: true,
    });
    expect(latestContext!.transcriptSessionId).toBe("owner");
    expect(latestContext!.sessionModel.config?.model).toBe("current");
    expect(mocks.call).toHaveBeenCalledWith("session/config", {
      sessionId: "owner",
    });
    expect(
      mocks.call.mock.calls.some(
        ([method]) => method === "models/list" || method === "session/resolve"
      )
    ).toBe(false);
    const lease = mocks.call.mock.calls.find(
      ([method]) => method === "session/open"
    )![1].subscriptionId;
    await act(async () => {
      permission.reject(new Error("permission timeout"));
      await opening;
    });
    await act(async () => {
      await latestContext!.unsubscribeSession();
    });
    expect(mocks.call).toHaveBeenCalledWith("session/unsubscribe", {
      subscriptionId: lease,
    });
  });

  it("prefetches imported identities only for a legacy identity-capable Desktop", async () => {
    await act(async () => {
      await latestContext!.unsubscribeSession();
    });
    const imported = {
      id: "codexapp-prefetch",
      name: "Imported Codex",
      status: "idle",
      sendCapability: "external_codex",
    };
    const native = {
      id: "cliagent-native",
      name: "Native",
      status: "idle",
      sendCapability: "native",
    };
    const base = mocks.call.getMockImplementation()!;
    let capabilities: Record<string, boolean> = { sessionIdentity: true };
    mocks.call.mockImplementation(
      (method: string, params?: Record<string, unknown>) => {
        if (method === "initialize")
          return Promise.resolve({
            protocolVersion: 1,
            tier: "full",
            capabilities,
          });
        if (method === "session/list")
          return Promise.resolve({
            sessions: [imported, native],
            hasMore: false,
          });
        if (method === "session/resolve")
          return Promise.resolve({
            sessionId: `owner-for-${String(params?.sessionId)}`,
            managed: true,
          });
        return base(method, params);
      }
    );

    await act(async () => {
      await latestContext!.connectLive({
        wsUrl: "wss://legacy.example.test/v1/mobile/ws",
      });
    });
    expect(latestContext!.sessions).toEqual([imported, native]);
    expect(
      mocks.call.mock.calls
        .filter(([method]) => method === "session/resolve")
        .map(([, params]) => params?.sessionId)
    ).toEqual(["codexapp-prefetch"]);

    mocks.call.mockClear();
    capabilities = { sessionIdentity: true, sessionOpen: true };
    await act(async () => {
      await latestContext!.connectLive({
        wsUrl: "wss://modern.example.test/v1/mobile/ws",
      });
    });
    expect(latestContext!.sessions).toEqual([imported, native]);
    expect(
      mocks.call.mock.calls.filter(([method]) => method === "session/resolve")
    ).toEqual([]);

    mocks.call.mockClear();
    capabilities = {};
    await act(async () => {
      await latestContext!.connectLive({
        wsUrl: "wss://old.example.test/v1/mobile/ws",
      });
    });
    expect(latestContext!.sessions).toEqual([imported, native]);
    expect(
      mocks.call.mock.calls.filter(([method]) => method === "session/resolve")
    ).toEqual([]);
  });

  it("restores the active transcript before a slow reconnect roster finishes", async () => {
    const roster = deferred<unknown>();
    const base = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(
      (method: string, params?: Record<string, unknown>) => {
        if (method === "session/list") return roster.promise;
        if (method === "session/subscribe") {
          return Promise.resolve({
            sessionId: params?.sessionId,
            rounds: { items: [{ id: "recovered-round" }], complete: true },
            snapshot: {
              sessionId: params?.sessionId,
              roundId: "recovered-round",
              version: 2,
              snapshotDelta: false,
              upserts: [
                {
                  id: "recovered-reply",
                  source: "assistant",
                  displayVariant: "message",
                  displayText: "Recovered before roster",
                },
              ],
            },
          });
        }
        return base(method, params);
      }
    );
    let recovery!: Promise<boolean>;
    await act(async () => {
      recovery = latestContext!.retryConnection();
      await Promise.resolve();
    });
    expect(latestContext!.transcriptPhase).toBe("ready");
    expect(latestContext!.transcriptItems.at(-1)).toMatchObject({
      text: "Recovered before roster",
    });
    await act(async () => {
      roster.resolve({ sessions: [] });
      await recovery;
    });
    expect(latestContext!.connection.presence).toBe("online");
  });

  it("renders a ready latest body while the full directory is still pending", async () => {
    const directory = deferred<unknown>();
    const base = mocks.call.getMockImplementation()!;
    const preview = {
      sessionId: "slow-history",
      historyDeferred: true,
      rounds: { items: [{ id: "recent" }], complete: false },
      snapshot: {
        sessionId: "slow-history",
        roundId: "recent",
        version: 1,
        snapshotDelta: false,
        upserts: [
          {
            id: "reply",
            source: "assistant",
            displayVariant: "message",
            displayText: "Ready before directory",
          },
        ],
      },
    };
    mocks.call.mockImplementation(
      (method: string, params?: Record<string, unknown>) => {
        if (
          method === "session/subscribe" &&
          params?.sessionId === "slow-history"
        )
          return Promise.resolve(preview);
        if (method === "session/history") return directory.promise;
        return base(method, params);
      }
    );
    await act(async () => {
      await latestContext!.subscribeSession("slow-history");
    });
    expect(latestContext!.transcriptPhase).toBe("ready");
    expect(latestContext!.transcriptItems).toHaveLength(1);
    expect(latestContext!.transcriptRoundsComplete).toBe(false);
    await act(async () => {
      directory.resolve({
        ...preview,
        historyDeferred: false,
        rounds: { items: [{ id: "older" }, { id: "recent" }], complete: true },
      });
      await directory.promise;
    });
    expect(latestContext!.transcriptRoundsComplete).toBe(true);
    expect(latestContext!.transcriptItems).toHaveLength(1);
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
      deviceLabel: "ORG2 Mobile",
    });
  });
  it("negotiates read-state sync and detaches it when the paired desktop goes offline", async () => {
    const original = mocks.call.getMockImplementation()!;
    let visited = false;
    mocks.call.mockImplementation((method, params) => {
      if (method === "initialize")
        return Promise.resolve({
          protocolVersion: 1,
          tier: "read_only",
          capabilities: { sessionReadState: true },
        });
      if (method === "session/read_state")
        return Promise.resolve({ visitedIds: visited ? ["session-a"] : [] });
      return original(method, params);
    });
    await act(async () =>
      latestContext!.connectLive({
        desktopId: "read-desktop",
        wsUrl: "wss://read.example/ws",
      })
    );
    await act(async () => latestContext!.readStateSync.watch(["session-a"]));
    expect(latestContext!.readStateSync.getSnapshot().get("session-a")).toBe(
      false
    );
    const providerValue = latestContext;
    await act(async () => {
      visited = true;
      mocks.notificationHandler!("session/read_state_changed", {});
    });
    expect(latestContext!.readStateSync.getSnapshot().get("session-a")).toBe(
      true
    );
    // Read updates are a list-only external-store subscription, not provider churn.
    expect(latestContext).toBe(providerValue);
    await act(async () =>
      mocks.notificationHandler!("relay/presence", { online: false })
    );
    expect(latestContext!.readStateSync.getSnapshot().size).toBe(0);
    const calls = mocks.call.mock.calls.length;
    await act(async () =>
      mocks.notificationHandler!("session/read_state_changed", {})
    );
    expect(mocks.call).toHaveBeenCalledTimes(calls);
  });

  it("clears navigation drafts on revoked close without discarding another desktop", async () => {
    if (!latestContext || !latestDraftStore)
      throw new Error("Provider did not supply draft owner");
    const scope = mobileComposerDesktopScope(
      latestContext.connectionConfig,
      latestContext.connection
    );
    const draft = latestDraftStore.scope(JSON.stringify([scope, "session-a"]));
    const other = latestDraftStore.scope(
      JSON.stringify(["another desktop", "session-a"])
    );
    draft.update((value) => ({ ...value, text: "private draft" }));
    other.update((value) => ({ ...value, text: "unrelated" }));
    const token = draft.capture();
    await act(async () =>
      FakeWebSocket.instances
        .at(-1)!
        .dispatchEvent(new CloseEvent("close", { code: 1008 }))
    );
    expect(draft.getSnapshot().text).toBe("");
    expect(other.getSnapshot().text).toBe("unrelated");
    draft.updateIfCurrent(token, (value) => ({ ...value, text: "late reply" }));
    expect(draft.getSnapshot().text).toBe("");
  });

  it("clears the owning draft store on teardown and rejects pending completions", async () => {
    if (!latestDraftStore)
      throw new Error("Provider did not supply draft owner");
    const draft = latestDraftStore.scope("session-a");
    draft.update((value) => ({ ...value, text: "private draft" }));
    const token = draft.capture();
    await act(async () => root.render(null));
    expect(draft.getSnapshot().text).toBe("");
    draft.updateIfCurrent(token, (value) => ({ ...value, text: "stale" }));
    expect(draft.getSnapshot().text).toBe("");
  });

  it("replaces and clears draft owners when identity or endpoint changes without a parent key", async () => {
    const platform = createBrowserMobileRemotePlatform();
    const renderIdentity = (authUserId: string, relayUrl: string) =>
      act(async () =>
        root.render(
          React.createElement(
            TestMobileRemotePlatformProvider,
            { platform },
            React.createElement(
              TestMobileRemoteProviders,
              {
                authUserId,
                relayUrl,
                demoByDefault: false,
                suppressInitialBootstrap: true,
              },
              React.createElement(Probe)
            )
          )
        )
      );
    await renderIdentity("user-a", "wss://one.example/ws");
    if (!latestDraftStore) throw new Error("Missing draft owner");
    const oldDraft = latestDraftStore.scope("session-a");
    oldDraft.update((value) => ({ ...value, text: "first account" }));
    await renderIdentity("user-b", "wss://one.example/ws");
    expect(oldDraft.getSnapshot().text).toBe("");
    const nextDraft = latestDraftStore.scope("session-a");
    expect(nextDraft.getSnapshot().text).toBe("");
    nextDraft.update((value) => ({ ...value, text: "second account" }));
    await renderIdentity("user-b", "wss://two.example/ws");
    expect(nextDraft.getSnapshot().text).toBe("");
    expect(latestDraftStore.scope("session-a").getSnapshot().text).toBe("");
  });

  async function mountBootstrappingProvider(
    load: ReturnType<
      typeof createBrowserMobileRemotePlatform
    >["connection"]["load"],
    listPairedDesktops = vi.fn().mockResolvedValue([]),
    save?: ReturnType<
      typeof createBrowserMobileRemotePlatform
    >["connection"]["save"]
  ) {
    act(() => root.unmount());
    root = createRoot(container);
    const browser = createBrowserMobileRemotePlatform();
    await act(async () =>
      root.render(
        React.createElement(
          TestMobileRemotePlatformProvider,
          {
            platform: {
              ...browser,
              connection: {
                ...browser.connection,
                load,
                listPairedDesktops,
                ...(save ? { save } : {}),
              },
            },
          },
          React.createElement(
            TestMobileRemoteProviders,
            { authUserId: "user-a", demoByDefault: false },
            React.createElement(Probe)
          )
        )
      )
    );
  }

  it("retries the selected pairing once without clearing its stored credentials", async () => {
    const config = {
      wsUrl: "wss://retry.example/ws",
      deviceToken: "paired-credential",
    };
    const save = vi.fn().mockResolvedValue(undefined);
    await mountBootstrappingProvider(
      vi.fn().mockResolvedValue(config),
      undefined,
      save
    );
    const previousCount = FakeWebSocket.instances.length;
    let first!: Promise<boolean>;
    await act(async () => {
      first = latestContext!.retryConnection();
      expect(latestContext!.retryConnection()).toBe(first);
      await first;
    });
    expect(FakeWebSocket.instances).toHaveLength(previousCount + 1);
    expect(latestContext!.connectionConfig).toMatchObject(config);
    expect(save.mock.calls.every(([, value]) => value !== null)).toBe(true);
    expect(latestContext!.connection.status).toBe("connected");
  });

  it("re-reads scoped storage after a bootstrap read failure", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValue({ wsUrl: "wss://recovered.example/ws" });
    await mountBootstrappingProvider(load);
    expect(latestContext!.connection.status).toBe("error");
    await act(async () => {
      expect(await latestContext!.retryConnection()).toBe(true);
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith("user-a");
    expect(latestContext!.connection.status).toBe("connected");
  });

  it("ignores a recovered stored pairing after an explicit disconnect", async () => {
    const restored = deferred<MobileConnectionConfig | null>();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("locked"))
      .mockImplementationOnce(() => restored.promise);
    await mountBootstrappingProvider(load);
    let retry!: Promise<boolean>;
    const socketCount = FakeWebSocket.instances.length;
    await act(async () => {
      retry = latestContext!.retryConnection();
    });
    await act(async () => latestContext!.disconnect());
    await act(async () => {
      restored.resolve({ wsUrl: "wss://stale.example/ws" });
      await retry;
    });
    expect(latestContext!.connection.status).toBe("disconnected");
    expect(latestContext!.connectionConfig).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(socketCount);
  });

  it("retains rows and retries a failed presence recovery without closing its authenticated socket", async () => {
    vi.useFakeTimers();
    try {
      const original = mocks.call.getMockImplementation()!;
      const row = { id: "retained", name: "Retained", status: "idle" };
      const list = vi
        .fn()
        .mockResolvedValue({ sessions: [row], hasMore: false });
      mocks.call.mockImplementation((method, params) =>
        method === "session/list" ? list() : original(method, params)
      );
      await act(async () => latestContext!.refreshSessions());
      list.mockRejectedValueOnce(new Error("Desktop warming up"));
      const socketCount = FakeWebSocket.instances.length;
      await act(async () =>
        mocks.notificationHandler!("relay/presence", { online: false })
      );
      await act(async () =>
        mocks.notificationHandler!("relay/presence", { online: true })
      );
      expect(latestContext!.sessions).toEqual([row]);
      expect(latestContext!.connection.presence).toBe("online");
      expect(latestContext!.rosterPhase).toBe("error");
      expect(FakeWebSocket.instances).toHaveLength(socketCount);
      await act(async () => vi.advanceTimersByTimeAsync(1500));
      expect(FakeWebSocket.instances).toHaveLength(socketCount);
      expect(latestContext!.rosterPhase).toBe("ready");
      expect(latestContext!.connection.presence).toBe("online");
      expect(latestContext!.sessions).toEqual([row]);
      const calls = list.mock.calls.length;
      await act(async () => vi.advanceTimersByTimeAsync(60000));
      expect(list).toHaveBeenCalledTimes(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a newly initialized socket online when its first roster read fails", async () => {
    vi.useFakeTimers();
    try {
      const original = mocks.call.getMockImplementation()!;
      const list = vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary"))
        .mockResolvedValue({ sessions: [] });
      mocks.call.mockImplementation((method, params) =>
        method === "session/list" ? list() : original(method, params)
      );
      await act(async () =>
        latestContext!.connectLive({ wsUrl: "wss://new.example/ws" })
      );
      expect(latestContext!.connection.status).toBe("connected");
      expect(latestContext!.rosterPhase).toBe("error");
      const sockets = FakeWebSocket.instances.length;
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(FakeWebSocket.instances).toHaveLength(sockets);
      expect(latestContext!.rosterPhase).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers an empty online roster after a failed list_changed notification", async () => {
    vi.useFakeTimers();
    try {
      const original = mocks.call.getMockImplementation()!;
      const list = vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary"))
        .mockResolvedValue({
          sessions: [{ id: "fresh", name: "Fresh", status: "idle" }],
        });
      mocks.call.mockImplementation((method, params) =>
        method === "session/list" ? list() : original(method, params)
      );
      const closes = mocks.close.mock.calls.length;
      await act(async () =>
        mocks.notificationHandler!("session/list_changed", {})
      );
      expect(latestContext!.rosterPhase).toBe("error");
      expect(latestContext!.connection.presence).toBe("online");
      expect(latestContext!.sessions).toEqual([]);
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(latestContext!.sessions.map((row) => row.id)).toEqual(["fresh"]);
      expect(latestContext!.rosterPhase).toBe("ready");
      expect(mocks.close).toHaveBeenCalledTimes(closes);
      await act(async () => vi.advanceTimersByTimeAsync(60000));
      expect(list).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds list retries, preserves last good rows, and allows a manual retry", async () => {
    vi.useFakeTimers();
    try {
      const original = mocks.call.getMockImplementation()!;
      const row = { id: "retained", name: "Retained", status: "idle" };
      const list = vi
        .fn()
        .mockResolvedValueOnce({ sessions: [row] })
        .mockRejectedValue(new Error("temporary"));
      mocks.call.mockImplementation((method, params) =>
        method === "session/list" ? list() : original(method, params)
      );
      await act(async () => latestContext!.refreshSessions());
      await act(async () =>
        mocks.notificationHandler!("session/list_changed", {})
      );
      await act(async () => vi.advanceTimersByTimeAsync(60000));
      expect(list).toHaveBeenCalledTimes(5);
      expect(latestContext!.sessions).toEqual([row]);
      expect(latestContext!.rosterPhase).toBe("error");
      list.mockResolvedValue({ sessions: [] });
      await act(async () => latestContext!.refreshSessions());
      expect(latestContext!.rosterPhase).toBe("ready");
      expect(latestContext!.sessions).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    Object.assign(new Error("Denied"), { code: -32002 }),
    { invalid: true },
  ])(
    "does not automatically retry a permanent roster failure: %s",
    async (error) => {
      vi.useFakeTimers();
      try {
        const original = mocks.call.getMockImplementation()!;
        const list = vi
          .fn()
          .mockImplementation(() =>
            error instanceof Error
              ? Promise.reject(error)
              : Promise.resolve({ sessions: "invalid" })
          );
        mocks.call.mockImplementation((method, params) =>
          method === "session/list" ? list() : original(method, params)
        );
        await act(async () =>
          mocks.notificationHandler!("session/list_changed", {})
        );
        expect(latestContext!.rosterPhase).toBe("error");
        await act(async () => vi.advanceTimersByTimeAsync(60000));
        expect(list).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it.each([
    undefined,
    null,
    {},
    [],
    { sessions: null },
    { sessions: false },
    { sessions: [], hasMore: "yes" },
    { sessions: [], hasMore: true },
    { sessions: [], hasMore: true, nextOffset: 0 },
    { sessions: [], nextOffset: -1 },
    { sessions: [], nextOffset: 0.5 },
  ])(
    "retains the last good roster for a malformed list response: %s",
    async (response) => {
      vi.useFakeTimers();
      try {
        const original = mocks.call.getMockImplementation()!;
        const row = { id: "retained", name: "Retained", status: "idle" };
        const list = vi
          .fn()
          .mockResolvedValueOnce({ sessions: [row] })
          .mockResolvedValue(response);
        mocks.call.mockImplementation((method, params) =>
          method === "session/list" ? list() : original(method, params)
        );
        await act(async () => latestContext!.refreshSessions());
        await act(async () =>
          mocks.notificationHandler!("session/list_changed", {})
        );
        expect(latestContext!.sessions).toEqual([row]);
        expect(latestContext!.rosterPhase).toBe("error");
        await act(async () => vi.advanceTimersByTimeAsync(60000));
        expect(list).toHaveBeenCalledTimes(2);
        list.mockResolvedValue({ sessions: [], nextOffset: 0, hasMore: false });
        await act(async () => latestContext!.refreshSessions());
        expect(latestContext!.sessions).toEqual([]);
        expect(latestContext!.rosterPhase).toBe("ready");
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it("pauses failed list recovery while hidden and refreshes once on return", async () => {
    vi.useFakeTimers();
    let hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    try {
      const original = mocks.call.getMockImplementation()!;
      const list = vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary"))
        .mockResolvedValue({ sessions: [] });
      mocks.call.mockImplementation((method, params) =>
        method === "session/list" ? list() : original(method, params)
      );
      await act(async () =>
        mocks.notificationHandler!("session/list_changed", {})
      );
      hidden = true;
      await act(async () =>
        document.dispatchEvent(new Event("visibilitychange"))
      );
      await act(async () => vi.advanceTimersByTimeAsync(60000));
      expect(list).toHaveBeenCalledTimes(1);
      hidden = false;
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(list).toHaveBeenCalledTimes(2);
      expect(latestContext!.rosterPhase).toBe("ready");
      await act(async () => vi.advanceTimersByTimeAsync(60000));
      expect(list).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(document, "hidden");
      vi.useRealTimers();
    }
  });

  it("discards a pending list retry on desktop switch and unmount", async () => {
    vi.useFakeTimers();
    try {
      const original = mocks.call.getMockImplementation()!;
      const list = vi
        .fn()
        .mockRejectedValueOnce(new Error("old desktop"))
        .mockResolvedValue({
          sessions: [{ id: "new", name: "New", status: "idle" }],
        });
      mocks.call.mockImplementation((method, params) =>
        method === "session/list" ? list() : original(method, params)
      );
      await act(async () =>
        mocks.notificationHandler!("session/list_changed", {})
      );
      await act(async () =>
        latestContext!.connectLive({ wsUrl: "wss://new.example/ws" })
      );
      await act(async () => vi.advanceTimersByTimeAsync(60000));
      expect(list).toHaveBeenCalledTimes(2);
      expect(latestContext!.sessions.map((row) => row.id)).toEqual(["new"]);
      list.mockRejectedValue(new Error("temporary"));
      await act(async () =>
        mocks.notificationHandler!("session/list_changed", {})
      );
      await act(async () => root.unmount());
      await act(async () => vi.advanceTimersByTimeAsync(60000));
      expect(list).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-initializes a recreated relay actor after an unauthorized presence recovery", async () => {
    vi.useFakeTimers();
    try {
      const original = mocks.call.getMockImplementation()!;
      const list = vi
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error("Initialize first"), { code: -32001 })
        )
        .mockResolvedValue({ sessions: [] });
      mocks.call.mockImplementation((method, params) =>
        method === "session/list" ? list() : original(method, params)
      );
      const sockets = FakeWebSocket.instances.length;
      await act(async () =>
        mocks.notificationHandler!("relay/presence", { online: false })
      );
      await act(async () =>
        mocks.notificationHandler!("relay/presence", { online: true })
      );
      expect(latestContext!.connection.presence).toBe("offline");
      await act(async () => vi.advanceTimersByTimeAsync(1500));
      expect(FakeWebSocket.instances).toHaveLength(sockets + 1);
      expect(latestContext!.connection.presence).toBe("online");
      expect(latestContext!.rosterPhase).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an old presence-recovery failure after switching desktops", async () => {
    const original = mocks.call.getMockImplementation()!;
    const oldRead = deferred<unknown>();
    const list = vi
      .fn()
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValue({
        sessions: [{ id: "new-desktop", name: "New", status: "idle" }],
        hasMore: false,
      });
    mocks.call.mockImplementation((method, params) =>
      method === "session/list" ? list() : original(method, params)
    );
    await act(async () =>
      mocks.notificationHandler!("relay/presence", { online: false })
    );
    await act(async () =>
      mocks.notificationHandler!("relay/presence", { online: true })
    );
    await act(async () =>
      latestContext!.connectLive({ wsUrl: "wss://new.example/ws" })
    );
    const closes = mocks.close.mock.calls.length;
    await act(async () => oldRead.reject(new Error("Old actor closed")));
    expect(mocks.close).toHaveBeenCalledTimes(closes);
    expect(latestContext!.connection.presence).toBe("online");
    expect(latestContext!.rosterPhase).toBe("ready");
    expect(latestContext!.sessions.map((row) => row.id)).toEqual([
      "new-desktop",
    ]);
  });

  it("reports a failed explicit connection reset instead of silently returning to welcome", async () => {
    const save = vi
      .fn()
      .mockImplementation((_user, config) =>
        config
          ? Promise.resolve()
          : Promise.reject(new Error("storage unavailable"))
      );
    await mountBootstrappingProvider(
      vi.fn().mockResolvedValue({ wsUrl: "wss://retry.example/ws" }),
      undefined,
      save
    );
    await act(async () => {
      await expect(latestContext!.disconnect()).rejects.toThrow(
        "storage unavailable"
      );
    });
    expect(latestContext!.connection.status).toBe("error");
    expect(latestContext!.connection.error?.message).toBe(
      "storage unavailable"
    );
  });

  it("publishes initialized desktop metadata and persists it for reload without changing credentials", async () => {
    const original = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((method, params) =>
      method === "initialize"
        ? Promise.resolve({
            protocolVersion: 1,
            tier: "full",
            desktopId: "different-process-id",
            desktopIdentity: {
              name: "Work Mac",
              model: "Mac14,7",
              username: "alex",
            },
          })
        : original(method, params)
    );
    const config = {
      desktopId: "stable-desktop",
      wsUrl: "wss://metadata.example/ws",
      deviceLabel: "My iPhone",
      deviceToken: "secret",
    };
    await act(async () => latestContext!.connectLive(config));
    expect(latestContext!.connection.desktopName).toBe("Work Mac");
    expect(
      latestContext!.pairedDesktops.find(
        (desktop) => desktop.id === config.desktopId
      )
    ).toMatchObject({
      name: "Work Mac",
      desktopIdentity: { model: "Mac14,7", username: "alex" },
    });
    expect(loadScopedMobileConnectionConfig("user-a", localStorage)).toEqual({
      ...config,
      desktopIdentity: { name: "Work Mac", model: "Mac14,7", username: "alex" },
    });
  });

  it("does not fail the connection when metadata persistence fails", async () => {
    const original = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((method, params) =>
      method === "initialize"
        ? Promise.resolve({
            protocolVersion: 1,
            desktopIdentity: { name: "Available Mac", username: "alex" },
          })
        : original(method, params)
    );
    const save = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("keychain unavailable"));
    await mountBootstrappingProvider(
      vi.fn().mockResolvedValue({ wsUrl: "wss://metadata-fail.example/ws" }),
      vi.fn().mockResolvedValue([]),
      save
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect(latestContext!.connection.status).toBe("connected");
    expect(latestContext!.connection.desktopName).toBe("Available Mac");
    expect(latestContext!.connectionConfig?.desktopIdentity?.username).toBe(
      "alex"
    );
    expect(latestContext!.pairedDesktops[0]).toMatchObject({
      name: "Available Mac",
      desktopIdentity: { username: "alex" },
    });
  });

  it("does not let a slow pre-initialize inventory erase the confirmed name", async () => {
    const oldInventory = deferred<never[]>();
    const original = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((method, params) =>
      method === "initialize"
        ? Promise.resolve({
            protocolVersion: 1,
            desktopIdentity: { name: "Confirmed Mac" },
          })
        : original(method, params)
    );
    const inventory = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => oldInventory.promise)
      .mockResolvedValue([
        {
          id: "confirmed",
          name: "Confirmed Mac",
          active: true,
          updatedAtMs: 1,
          desktopIdentity: { name: "Confirmed Mac" },
        },
      ]);
    await mountBootstrappingProvider(
      vi.fn().mockResolvedValue({
        desktopId: "confirmed",
        wsUrl: "wss://confirmed.example/ws",
      }),
      inventory
    );
    await act(async () => {
      oldInventory.resolve([]);
    });
    expect(latestContext!.pairedDesktops[0].name).toBe("Confirmed Mac");
  });

  it("retries unchanged desktop metadata after a failed save on reconnect", async () => {
    const original = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((method, params) =>
      method === "initialize"
        ? Promise.resolve({
            protocolVersion: 1,
            desktopIdentity: { name: "Retry Mac" },
          })
        : original(method, params)
    );
    const save = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValue(undefined);
    await mountBootstrappingProvider(
      vi.fn().mockResolvedValue({ wsUrl: "wss://retry-metadata.example/ws" }),
      vi.fn().mockResolvedValue([]),
      save
    );
    expect(save).toHaveBeenCalledTimes(2);
    const cached = latestContext!.connectionConfig!;
    await act(async () => latestContext!.connectLive(cached));
    expect(save).toHaveBeenCalledTimes(4);
    expect(save.mock.calls[3][1]).toMatchObject({
      desktopIdentity: { name: "Retry Mac" },
    });
    expect(latestContext!.connection.status).toBe("connected");
  });

  it("ignores an old desktop identity arriving after another computer was selected", async () => {
    const old = deferred<unknown>();
    const original = mocks.call.getMockImplementation()!;
    let initializes = 0;
    mocks.call.mockImplementation((method, params) =>
      method === "initialize"
        ? ++initializes === 1
          ? old.promise
          : Promise.resolve({
              protocolVersion: 1,
              desktopIdentity: { name: "New Mac" },
            })
        : original(method, params)
    );
    let first!: Promise<void>;
    await act(async () => {
      first = latestContext!
        .connectLive({ desktopId: "old", wsUrl: "wss://old.example/ws" })
        .catch(() => undefined);
    });
    await act(async () =>
      latestContext!.connectLive({
        desktopId: "new",
        wsUrl: "wss://new.example/ws",
      })
    );
    await act(async () => {
      old.resolve({ protocolVersion: 1, desktopIdentity: { name: "Old Mac" } });
      await first;
    });
    expect(latestContext!.connection.desktopName).toBe("New Mac");
    expect(
      loadScopedMobileConnectionConfig("user-a", localStorage)?.desktopIdentity
        ?.name
    ).toBe("New Mac");
  });

  it("finishes local bootstrap before a slow handshake or device inventory", async () => {
    const handshake = deferred<{ protocolVersion: number; tier: string }>();
    const inventory = deferred<never[]>();
    const original = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((method, params) =>
      method === "initialize" ? handshake.promise : original(method, params)
    );
    const config = { wsUrl: "wss://restored.example.test/v1/mobile/ws" };
    mocks.call.mockClear();
    await mountBootstrappingProvider(
      vi.fn().mockResolvedValue(config),
      vi.fn(() => inventory.promise)
    );
    expect(latestContext?.bootstrapPending).toBe(false);
    expect(latestContext?.connectionConfig).toEqual(config);
    expect(latestContext?.connection.status).not.toBe("connected");
    expect(mocks.call).toHaveBeenCalledWith("initialize", expect.any(Object));
    await act(async () => {
      handshake.resolve({ protocolVersion: 1, tier: "full" });
    });
    // Neither initial inventory nor the post-save inventory ever resolves.
    expect(latestContext?.connection.status).toBe("connected");
  });

  it("keeps bootstrap pending only while stored configuration is loading", async () => {
    const stored = deferred<null>();
    await mountBootstrappingProvider(vi.fn(() => stored.promise));
    expect(latestContext?.bootstrapPending).toBe(true);
    expect(latestContext?.connectionConfig).toBeNull();
    const socketCount = FakeWebSocket.instances.length;
    await act(async () => stored.resolve(null));
    expect(latestContext?.bootstrapPending).toBe(false);
    expect(latestContext?.connectionConfig).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(socketCount);
  });

  it("durably completes pairing at Relay approval even when Desktop is offline, then reloads without SAS", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const original = mocks.call.getMockImplementation()!;
      let online = false;
      mocks.call.mockImplementation((method, params) =>
        method === "initialize" && !online
          ? Promise.reject(new Error("desktop is offline"))
          : original(method, params)
      );
      const config: MobileConnectionConfig = {
        wsUrl: "wss://relay.example.test/v1/mobile/ws",
        desktopId: "paired-restart-test",
        deviceToken: "durable-device-credential",
        deviceLabel: "My phone",
        pairingCode: "ONE-TIME",
      };
      let result: Promise<unknown> | undefined;
      await act(async () => {
        result = latestContext?.connectLive(config).catch((error) => error);
      });
      expect(latestContext?.connectionConfig?.pairingCode).toBe("ONE-TIME");
      await act(async () => {
        mocks.notificationHandler?.("pairing/approved", {});
        await result;
      });
      const restored = loadScopedMobileConnectionConfig("user-a", localStorage);
      expect(restored).toEqual({
        wsUrl: config.wsUrl,
        desktopId: config.desktopId,
        deviceToken: config.deviceToken,
        deviceLabel: config.deviceLabel,
      });
      expect(latestContext?.connection.status).toBe("connecting");
      expect(latestContext?.connection.presence).toBe("offline");

      // A new app process uses the real stored credential, not the QR payload.
      await mountBootstrappingProvider(() => Promise.resolve(restored));
      expect(latestContext?.connection.status).toBe("connecting");
      online = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(latestContext?.connection.status).toBe("connected");
      expect(latestContext?.connectionConfig?.pairingCode).toBeUndefined();
      expect(latestContext?.connectionConfig?.deviceToken).toBe(
        config.deviceToken
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers a saved device when Desktop returns, with no repeated attempts while hidden", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    try {
      const original = mocks.call.getMockImplementation()!;
      let online = false;
      mocks.call.mockImplementation((method, params) =>
        method === "initialize" && !online
          ? Promise.reject(new Error("desktop is offline"))
          : original(method, params)
      );
      const config = {
        wsUrl: "wss://restored.example.test/v1/mobile/ws",
        deviceToken: "saved",
      };
      await mountBootstrappingProvider(vi.fn().mockResolvedValue(config));
      expect(latestContext?.connection.status).toBe("connecting");
      expect(latestContext?.connectionConfig).toEqual(config);
      const initialCount = FakeWebSocket.instances.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(FakeWebSocket.instances).toHaveLength(initialCount + 1);
      hidden = true;
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(FakeWebSocket.instances).toHaveLength(initialCount + 1);
      online = true;
      hidden = false;
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(FakeWebSocket.instances).toHaveLength(initialCount + 2);
      expect(latestContext?.connection.status).toBe("connected");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(FakeWebSocket.instances).toHaveLength(initialCount + 2);
    } finally {
      Reflect.deleteProperty(document, "hidden");
      vi.useRealTimers();
    }
  });

  it("cancels an offline device retry without deleting the paired inventory", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const config = {
        wsUrl: "wss://retry.example.test/v1/mobile/ws",
        desktopId: "cancel-retry",
        deviceToken: "saved",
      };
      mocks.call.mockRejectedValue(new Error("desktop is offline"));
      await mountBootstrappingProvider(vi.fn().mockResolvedValue(config));
      const count = FakeWebSocket.instances.length;
      await act(async () => {
        await latestContext?.disconnect();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(FakeWebSocket.instances).toHaveLength(count);
      expect(latestContext?.connection.status).toBe("disconnected");
      expect(
        await createBrowserMobileRemotePlatform().connection.listPairedDesktops(
          "user-a"
        )
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "cancel-retry", active: false }),
        ])
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not confirm or automatically retry an expired first pairing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const config = {
        wsUrl: "wss://relay.example.test/v1/mobile/ws",
        pairingCode: "EXPIRED",
        deviceToken: "pending",
      };
      let result: Promise<unknown> | undefined;
      await act(async () => {
        result = latestContext?.connectLive(config).catch((error) => error);
      });
      const count = FakeWebSocket.instances.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(130_001);
      });
      expect(await result).toBeInstanceOf(Error);
      expect(latestContext?.connection.status).toBe("error");
      expect(
        loadScopedMobileConnectionConfig("user-a", localStorage)?.pairingCode
      ).toBe("EXPIRED");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(FakeWebSocket.instances).toHaveLength(count);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry authorization denied before initialize completes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      if (!latestContext || !latestDraftStore)
        throw new Error("Missing draft owner");
      const config = { wsUrl: "wss://relay.example.test/v1/mobile/ws" };
      const draft = latestDraftStore.scope(
        JSON.stringify([mobileComposerDesktopScope(config, {}), "session-a"])
      );
      draft.update((value) => ({ ...value, text: "draft before reconnect" }));
      const handshake = deferred<never>();
      mocks.call.mockImplementation(() => handshake.promise);
      let result: Promise<unknown> | undefined;
      await act(async () => {
        result = latestContext
          ?.connectLive({ wsUrl: "wss://relay.example.test/v1/mobile/ws" })
          .catch((error) => error);
      });
      const socket = FakeWebSocket.instances.at(-1)!;
      const count = FakeWebSocket.instances.length;
      await act(async () => {
        socket.readyState = FakeWebSocket.CLOSED;
        socket.dispatchEvent(new CloseEvent("close", { code: 1008 }));
        handshake.reject(new Error("WebSocket closed"));
        await result;
      });
      expect(latestContext?.connection.status).toBe("error");
      expect(draft.getSnapshot().text).toBe("");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(FakeWebSocket.instances).toHaveLength(count);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["ticket-denied", "initialize-denied", "network-error"])(
    "handles %s at the draft authority boundary",
    async (failure) => {
      const browser = createBrowserMobileRemotePlatform();
      const config = {
        wsUrl: "wss://relay.example.test/v1/mobile/ws",
        desktopId: "desktop-one",
      };
      const error =
        failure === "network-error"
          ? new Error("network unavailable")
          : new MobileConnectionAuthorizationError("Pairing revoked");
      const originalCall = mocks.call.getMockImplementation()!;
      mocks.call.mockImplementation((method, params) =>
        failure === "initialize-denied" && method === "initialize"
          ? Promise.reject(error)
          : originalCall(method, params)
      );
      const platform = {
        ...browser,
        connection: {
          ...browser.connection,
          prepareSocketUrl: async () => {
            if (failure !== "initialize-denied") throw error;
            return config.wsUrl;
          },
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
      if (!latestDraftStore || !latestContext)
        throw new Error("Missing draft owner");
      const draft = latestDraftStore.scope(
        JSON.stringify([mobileComposerDesktopScope(config, {}), "session-a"])
      );
      draft.update((value) => ({ ...value, text: "keep only if transient" }));
      await act(async () => {
        await latestContext!.connectLive(config).catch(() => undefined);
      });
      expect(draft.getSnapshot().text).toBe(
        failure === "network-error" ? "keep only if transient" : ""
      );
    }
  );

  it("releases bootstrap and reports a failed configuration read", async () => {
    const stored = deferred<null>();
    await mountBootstrappingProvider(vi.fn(() => stored.promise));
    expect(latestContext?.bootstrapPending).toBe(true);
    await act(async () =>
      stored.reject(new Error("secure storage unavailable"))
    );
    expect(latestContext?.bootstrapPending).toBe(false);
    expect(latestContext?.connectionConfig).toBeNull();
    expect(latestContext?.connection.status).toBe("error");
  });

  it("retries a failed approval save after Desktop recovers without requiring metadata", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const browser = createBrowserMobileRemotePlatform();
      const save = vi.fn(browser.connection.save);
      save
        .mockImplementationOnce(browser.connection.save)
        .mockRejectedValueOnce(
          new Error("secure storage temporarily unavailable")
        );
      const original = mocks.call.getMockImplementation()!;
      let online = false;
      mocks.call.mockImplementation((method, params) =>
        method === "initialize" && !online
          ? Promise.reject(new Error("desktop is offline"))
          : original(method, params)
      );
      const config = {
        wsUrl: "wss://relay.example.test/v1/mobile/ws",
        desktopId: "approval-save-retry",
        deviceToken: "saved",
        pairingCode: "once",
      };
      await mountBootstrappingProvider(
        vi.fn().mockResolvedValue(config),
        undefined,
        save
      );
      await act(async () => {
        mocks.notificationHandler?.("pairing/approved", {});
      });
      expect(save).toHaveBeenCalledTimes(2);
      expect(
        loadScopedMobileConnectionConfig("user-a", localStorage)?.pairingCode
      ).toBe("once");
      online = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(latestContext?.connection.status).toBe("connected");
      expect(save).toHaveBeenCalledTimes(3);
      expect(
        loadScopedMobileConnectionConfig("user-a", localStorage)?.pairingCode
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not persist a late approval after the user disconnects", async () => {
    let connecting: Promise<unknown> | undefined;
    await act(async () => {
      connecting = latestContext
        ?.connectLive({
          wsUrl: "wss://relay.example.test/v1/mobile/ws",
          pairingCode: "once",
          deviceToken: "pending",
        })
        .catch((error) => error);
    });
    await act(async () => {
      mocks.notificationHandler?.("pairing/approved", {});
      await latestContext?.disconnect();
      await connecting;
    });
    expect(latestContext?.connection.status).toBe("disconnected");
    expect(latestContext?.connectionConfig).toBeNull();
    expect(loadScopedMobileConnectionConfig("user-a", localStorage)).toBeNull();
  });

  it("ignores a hidden attempt's late initialize after a visible recovery succeeds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    try {
      const handshake = deferred<{ protocolVersion: number }>();
      mocks.call.mockImplementationOnce(() => handshake.promise);
      let connecting: Promise<unknown> | undefined;
      await act(async () => {
        connecting = latestContext
          ?.connectLive({ wsUrl: "wss://relay.example.test/v1/mobile/ws" })
          .catch((error) => error);
      });
      hidden = true;
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      hidden = false;
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(latestContext?.connection.status).toBe("connected");
      const count = FakeWebSocket.instances.length;
      await act(async () => {
        handshake.resolve({ protocolVersion: 1 });
        await connecting;
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(latestContext?.connection.status).toBe("connected");
      expect(latestContext?.connection.presence).toBe("online");
      expect(FakeWebSocket.instances).toHaveLength(count);
    } finally {
      Reflect.deleteProperty(document, "hidden");
      vi.useRealTimers();
    }
  });

  it("reports a saved-device persistence failure instead of staying connecting", async () => {
    const config = { wsUrl: "wss://restored.example.test/v1/mobile/ws" };
    const save = vi
      .fn()
      .mockRejectedValue(new Error("secure storage write failed"));
    mocks.call.mockClear();
    await mountBootstrappingProvider(
      vi.fn().mockResolvedValue(config),
      undefined,
      save
    );
    expect(save).toHaveBeenCalled();
    expect(latestContext?.bootstrapPending).toBe(false);
    expect(latestContext?.connection.status).toBe("error");
    expect(mocks.call).not.toHaveBeenCalledWith(
      "initialize",
      expect.any(Object)
    );
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

  it("replaces fallback rows with canonical desktop snapshots and coalesces list-change bursts", async () => {
    const canonical = {
      id: "desktop-current",
      name: "Canonical desktop title",
      status: "running",
      repoName: "Project",
      repoPath: "/project",
      updatedAtMs: 123,
      display: { cliAgentType: "codex" },
    };
    const stale = deferred<{ sessions: (typeof canonical)[] }>();
    const fresh = deferred<{ sessions: (typeof canonical)[] }>();
    const original = mocks.call.getMockImplementation()!;
    const list = vi
      .fn()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise)
      .mockResolvedValue({ sessions: [], hasMore: false });
    mocks.call.mockImplementation((method, params) =>
      method === "session/list" ? list() : original(method, params)
    );
    const previous = latestContext!.sessions;
    await act(async () => {
      for (let i = 0; i < 20; i++) {
        mocks.notificationHandler!("session/list_changed", {});
      }
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(latestContext!.sessions).toEqual(previous);
    await act(async () => {
      stale.resolve({ sessions: [{ ...canonical, name: "Stale title" }] });
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(latestContext!.sessions).toEqual(previous);
    await act(async () => {
      fresh.resolve({ sessions: [canonical] });
    });
    expect(latestContext!.sessions).toEqual([canonical]);
    expect(latestContext!.sessionsHasMore).toBe(false);
    await act(async () => {
      mocks.notificationHandler!("session/list_changed", {});
    });
    expect(latestContext!.sessions).toEqual([]);
    expect(list).toHaveBeenCalledTimes(3);
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

  it("reloads the roster once when Desktop returns on the surviving relay socket", async () => {
    const original = mocks.call.getMockImplementation()!;
    const list = vi.fn().mockResolvedValue({
      sessions: [
        { id: "after-desktop-restart", name: "Recovered", status: "idle" },
      ],
      hasMore: false,
    });
    mocks.call.mockImplementation((method, params) =>
      method === "session/list" ? list() : original(method, params)
    );
    const socketCount = FakeWebSocket.instances.length;
    const notify = mocks.notificationHandler!;
    const subscriptions = mocks.call.mock.calls.filter(
      ([method]) => method === "session/subscribe"
    ).length;
    await act(async () => notify("relay/presence", { online: false }));
    expect(list).not.toHaveBeenCalled();
    await act(async () => {
      notify("relay/presence", { online: true });
      notify("relay/presence", { online: true });
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(latestContext!.sessions.map((row) => row.id)).toEqual([
      "after-desktop-restart",
    ]);
    expect(FakeWebSocket.instances).toHaveLength(socketCount);
    expect(
      mocks.call.mock.calls.filter(([method]) => method === "session/subscribe")
    ).toHaveLength(subscriptions + 1);
    expect(mocks.sendParams).toBeNull();
  });

  it("keeps session lifecycle callbacks stable across presence changes", async () => {
    const initialSubscribe = latestContext?.subscribeSession;
    const initialUnsubscribe = latestContext?.unsubscribeSession;

    await act(async () => {
      mocks.notificationHandler?.("relay/presence", { online: false });
    });
    await act(async () => {
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

  it("retains a classified ticket failure during automatic retry and clears it after initialize", async () => {
    act(() => root.unmount());
    root = createRoot(container);
    latestContext = null;
    FakeWebSocket.instances = [];
    const prepared = deferred<string>();
    const browser = createBrowserMobileRemotePlatform();
    const prepareSocketUrl = vi
      .fn()
      .mockRejectedValueOnce(
        new MobileConnectionTicketError("Invalid Relay connection ticket")
      )
      .mockReturnValueOnce(prepared.promise);
    const platform = {
      ...browser,
      connection: { ...browser.connection, prepareSocketUrl },
    };
    vi.useFakeTimers();
    try {
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
      await act(async () => {
        await expect(
          latestContext!.connectLive({
            wsUrl: "wss://relay.example/v1/mobile/ws",
          })
        ).rejects.toThrow();
      });
      expect(latestContext!.connection.error?.connectionIssue).toBe("ticket");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(prepareSocketUrl).toHaveBeenCalledTimes(2);
      expect(latestContext!.connection.status).toBe("connecting");
      expect(latestContext!.connection.error?.connectionIssue).toBe("ticket");
      await act(async () => {
        prepared.resolve("wss://relay.example/v1/mobile/ws?ticket=valid");
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(latestContext!.connection.status).toBe("connected");
      expect(latestContext!.connection.error).toBeUndefined();
      expect(FakeWebSocket.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
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
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(1, "user-a", explicitConfig);
    expect(save).toHaveBeenNthCalledWith(2, "user-a", explicitConfig);
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
        await expect(pending).resolves.toBeUndefined();
      });

      expect(latestContext?.permissionSubmitting).toBe(false);
      expect(latestContext?.activePermission?.requestId).toBe("hookperm-retry");
      expect(latestContext?.permissionFailed).toBe(true);
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

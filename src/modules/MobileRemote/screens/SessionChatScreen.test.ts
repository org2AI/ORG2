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

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import {
  invalidateMobileSessionIdentities,
  prefetchMobileSessionIdentities,
} from "../connection/mobileSessionIdentityCache";
import type { TranscriptItem } from "../lib/transcriptReducer";
import { SessionChatScreen } from "./SessionChatScreen";

const mocks = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  transcriptProps: null as Record<string, unknown> | null,
  composerProps: null as Record<string, unknown> | null,
  permissionProps: null as Record<string, unknown> | null,
}));

vi.mock("../app", () => ({
  useMobileRemote: () => mocks.context,
}));

vi.mock("../platform", () => ({
  useMobileRemotePlatform: () => ({
    runtime: {
      isHidden: () => false,
      subscribeVisibility: () => () => {},
    },
  }),
}));

vi.mock("../components/MobileTopBar", () => ({
  MobileTopBar: () => null,
}));
vi.mock("../components/MobileActionButton", () => ({
  MobileActionButton: (props: Record<string, unknown>) =>
    React.createElement("button", props),
}));

vi.mock("../components/composer/MobileComposer", () => ({
  MobileComposer: (props: Record<string, unknown>) => {
    mocks.composerProps = props;
    return React.createElement(
      "div",
      { "data-testid": "composer" },
      String(props.disabledReason ?? "")
    );
  },
}));

vi.mock("../components/transcript/ChatTranscript", () => ({
  ChatTranscript: (props: Record<string, unknown>) => {
    mocks.transcriptProps = props;
    return React.createElement("div", { "data-testid": "chat-transcript" });
  },
}));

vi.mock("../components/transcript/RoundNavigator", () => ({
  RoundNavigator: () => null,
}));

vi.mock("@src/components/Button", () => ({
  default: () => null,
}));

vi.mock("@src/components/PermissionPrompt", () => ({
  PermissionSheet: (props: Record<string, unknown>) => {
    mocks.permissionProps = props;
    return null;
  },
}));

vi.mock("@src/icons", () => ({
  HugeiconsIcon: () => null,
  StopCircleIcon: {},
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const OPTIMISTIC_USER: TranscriptItem = {
  id: "mobile-user-turn-1",
  kind: "user",
  text: "Run the tests",
  optimistic: true,
  turnIntentId: "turn-1",
};

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    connection: {
      status: "connected",
      presence: "online",
      tier: "full",
    },
    transcriptItems: [OPTIMISTIC_USER],
    transcriptPhase: "ready",
    transcriptError: undefined,
    transcriptTruncated: false,
    transcriptRounds: [],
    transcriptRoundsComplete: true,
    selectedRoundId: null,
    activeRoundId: "local-pending:turn-1",
    sendStatus: {
      sessionId: "session-a",
      turnIntentId: "turn-1",
      phase: "accepted",
    },
    activePermission: null,
    permissionQueueDepth: 0,
    sessionModel: {
      config: {
        sessionId: "session-a",
        model: "claude-sonnet-4-5",
        modelEditable: true,
      },
      options: [],
      loading: false,
      patching: false,
    },
    loadSessionModels: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
    respondPermission: vi.fn(),
    subscribeSession: vi.fn().mockResolvedValue(undefined),
    unsubscribeSession: vi.fn().mockResolvedValue(undefined),
    selectRound: vi.fn(),
    retrySelectedRound: vi.fn(),
    retryConnection: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("SessionChatScreen Agent loading state", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.transcriptProps = null;
    mocks.composerProps = null;
    mocks.context = createContext();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  async function renderScreen(sessionId = "session-a") {
    await act(async () => {
      root.render(
        React.createElement(SessionChatScreen, {
          sessionId,
          sessionName: "Remote session",
        })
      );
    });
  }

  it("passes timing from the selected round instead of the latest round", async () => {
    const earlier = { id: "earlier", status: "completed", durationMs: 198_000 };
    const latest = { id: "latest", status: "pending", durationMs: null };
    mocks.context = createContext({
      transcriptRounds: [earlier, latest],
      activeRoundId: earlier.id,
      selectedRoundId: earlier.id,
    });
    await renderScreen();
    expect(mocks.transcriptProps?.round).toEqual(earlier);
    mocks.context = {
      ...mocks.context,
      activeRoundId: latest.id,
      selectedRoundId: null,
    };
    await renderScreen();
    expect(mocks.transcriptProps?.round).toEqual(latest);
  });

  it("mounts combined opening immediately and keeps canonical route replacement on one subscription", async () => {
    const call = vi.fn();
    const context = createContext({
      rpc: { call },
      openingReady: false,
      openedSession: {
        requested: "mirror",
        sessionId: "old-owner",
        managed: true,
      },
      connection: {
        status: "connected",
        presence: "online",
        tier: "full",
        capabilities: { sessionOpen: true, sessionIdentity: true },
      },
    });
    mocks.context = context;
    const onCanonicalSession = vi.fn();
    const render = (sessionId: string) =>
      root.render(
        React.createElement(SessionChatScreen, {
          sessionId,
          sessionName: "Mirror",
          sendCapability: "read_only",
          onCanonicalSession,
        })
      );
    await act(async () => render("mirror"));
    expect(call).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("connection.resolvingSession");
    expect(context.subscribeSession).toHaveBeenCalledWith("mirror");
    expect(onCanonicalSession).not.toHaveBeenCalled();
    expect(mocks.composerProps?.disabled).toBe(true);
    mocks.context = {
      ...context,
      openingReady: true,
      openedSession: { requested: "mirror", sessionId: "owner", managed: true },
    };
    await act(async () => render("mirror"));
    expect(onCanonicalSession).toHaveBeenCalledWith("owner");
    expect(mocks.composerProps?.disabled).toBe(false);
    await act(async () => render("owner"));
    expect(context.subscribeSession).toHaveBeenCalledTimes(1);
    expect(context.unsubscribeSession).not.toHaveBeenCalled();
    await act(async () => {
      await (mocks.composerProps!.onSend as (value: string) => Promise<void>)(
        "hello"
      );
    });
    expect(context.sendMessage).toHaveBeenCalledWith("owner", "hello", []);
  });

  it.each([
    "sdeagent-native",
    "cliagent-native",
    "claudecodeapp-history",
    "cursoride-history",
  ])(
    "opens %s directly on identity-capable Desktop without a confirmation RPC",
    async (id) => {
      const call = vi.fn(() => new Promise(() => {}));
      const context = createContext({
        rpc: { call },
        connection: {
          status: "connected",
          presence: "online",
          tier: "read_only",
          capabilities: { sessionIdentity: true },
        },
      });
      mocks.context = context;
      await renderScreen(id);
      expect(call).not.toHaveBeenCalled();
      expect(context.subscribeSession).toHaveBeenCalledWith(id);
      expect(container.textContent).not.toContain(
        "connection.resolvingSession"
      );
      expect(
        container.querySelector('[data-testid="chat-transcript"]')
      ).not.toBeNull();
      expect(mocks.composerProps?.disabled).toBe(true);
    }
  );

  it("resolves before chat mounts, then uses one managed id for subscribe/send/model and navigation", async () => {
    let resolve!: (value: unknown) => void;
    const call = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const onCanonicalSession = vi.fn();
    mocks.context = createContext({
      rpc: { call },
      connection: {
        status: "connected",
        presence: "online",
        tier: "full",
        capabilities: { sessionIdentity: true },
      },
    });
    await act(async () =>
      root.render(
        React.createElement(SessionChatScreen, {
          sessionId: "codexapp-imported",
          sessionName: "Imported mirror",
          sendCapability: "read_only",
          onCanonicalSession,
        })
      )
    );
    expect(mocks.context.subscribeSession).not.toHaveBeenCalled();
    expect(mocks.composerProps).toBeNull();
    expect(container.textContent).toContain("connection.resolvingSession");
    expect(container.textContent).not.toContain("transcript.loading");
    expect(container.querySelector(".mobile-loading-dots")).not.toBeNull();
    await act(async () =>
      resolve({ sessionId: "cliagent-owner", managed: true })
    );
    expect(onCanonicalSession).toHaveBeenCalledWith("cliagent-owner");
    expect(mocks.context.subscribeSession).toHaveBeenCalledWith(
      "cliagent-owner"
    );
    expect(mocks.composerProps?.disabled).toBe(false);
    await act(async () => {
      await (mocks.composerProps?.onSend as (text: string) => Promise<void>)(
        "hello"
      );
      await (
        mocks.composerProps?.modelPicker as {
          onSelect: (option: unknown) => Promise<void>;
        }
      ).onSelect({ id: "model", accountId: "account" });
    });
    expect(mocks.context.sendMessage).toHaveBeenCalledWith(
      "cliagent-owner",
      "hello",
      []
    );
    expect(mocks.context.setSessionModel).toHaveBeenCalledWith(
      "cliagent-owner",
      { id: "model", accountId: "account" }
    );
    await act(async () =>
      root.render(
        React.createElement(SessionChatScreen, {
          sessionId: "cliagent-owner",
          sessionName: "Imported mirror",
          sendCapability: "read_only",
          onCanonicalSession,
        })
      )
    );
    expect(call).toHaveBeenCalledOnce();
    expect(mocks.context.subscribeSession).toHaveBeenCalledOnce();
    expect(mocks.composerProps?.disabled).toBe(false);
  });

  it("reopens a resolved conversation without another identity request or confirmation gate", async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ sessionId: "owner", managed: true });
    const rpc: MobileRpcClient = {
      call,
      notify: vi.fn(),
      close: vi.fn(),
      readyState: 1,
      onNotification: () => () => {},
    };
    const context = createContext({
      rpc,
      connection: {
        status: "connected",
        presence: "online",
        tier: "read_only",
        capabilities: { sessionIdentity: true },
      },
    });
    mocks.context = context;
    await renderScreen("codexapp-imported");
    await act(async () => root.render(null));
    mocks.composerProps = null;
    await renderScreen("codexapp-imported");
    expect(call).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("connection.resolvingSession");
    expect(
      container.querySelector('[data-testid="chat-transcript"]')
    ).not.toBeNull();
    expect(mocks.composerProps).toMatchObject({ disabled: true });
    expect(context.sendMessage).not.toHaveBeenCalled();
    expect(context.subscribeSession).toHaveBeenCalledTimes(2);

    await act(async () => root.render(null));
    invalidateMobileSessionIdentities(rpc);
    call.mockResolvedValueOnce({
      sessionId: "replacement-owner",
      managed: true,
    });
    await renderScreen("codexapp-imported");
    expect(call).toHaveBeenCalledTimes(2);
    expect(context.subscribeSession).toHaveBeenLastCalledWith(
      "replacement-owner"
    );
  });

  it("opens a prefetched legacy mirror without another resolve or confirmation gate", async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ sessionId: "cliagent-owner", managed: true });
    const rpc: MobileRpcClient = {
      call,
      notify: vi.fn(),
      close: vi.fn(),
      readyState: 1,
      onNotification: () => () => {},
    };
    await prefetchMobileSessionIdentities(rpc, [
      {
        id: "codexapp-imported",
        name: "Imported Codex",
        status: "idle",
        sendCapability: "external_codex",
      },
    ]);
    invalidateMobileSessionIdentities(rpc);
    await prefetchMobileSessionIdentities(rpc, [
      {
        id: "codexapp-imported",
        name: "Imported Codex",
        status: "idle",
        sendCapability: "external_codex",
      },
    ]);
    expect(call).toHaveBeenCalledTimes(2);
    call.mockClear();
    const context = createContext({
      rpc,
      connection: {
        status: "connected",
        presence: "online",
        tier: "full",
        capabilities: { sessionIdentity: true },
      },
    });
    mocks.context = context;

    await act(async () =>
      root.render(
        React.createElement(SessionChatScreen, {
          sessionId: "codexapp-imported",
          sessionName: "Imported Codex",
          sendCapability: "external_codex",
        })
      )
    );

    expect(call).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("connection.resolvingSession");
    expect(context.subscribeSession).toHaveBeenCalledWith("cliagent-owner");
    expect(
      container.querySelector('[data-testid="chat-transcript"]')
    ).not.toBeNull();
  });

  it("rechecks a mounted imported mirror on invalidation before mounting its new owner", async () => {
    let finish!: (value: unknown) => void;
    const call = vi
      .fn()
      .mockResolvedValueOnce({ sessionId: "codexapp-imported", managed: false })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
    const rpc: MobileRpcClient = {
      call,
      notify: vi.fn(),
      close: vi.fn(),
      readyState: 1,
      onNotification: () => () => {},
    };
    const context = createContext({
      rpc,
      connection: {
        status: "connected",
        presence: "online",
        tier: "full",
        capabilities: { sessionIdentity: true },
      },
    });
    mocks.context = context;
    await renderScreen("codexapp-imported");
    expect(context.subscribeSession).toHaveBeenCalledWith("codexapp-imported");
    await act(async () => invalidateMobileSessionIdentities(rpc));
    expect(call).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector('[data-testid="chat-transcript"]')
    ).toBeNull();
    expect(context.unsubscribeSession).toHaveBeenCalledOnce();
    await act(async () =>
      finish({ sessionId: "cliagent-new-owner", managed: true })
    );
    expect(context.subscribeSession).toHaveBeenLastCalledWith(
      "cliagent-new-owner"
    );
    expect(
      container.querySelector('[data-testid="chat-transcript"]')
    ).not.toBeNull();
  });

  it("shares an unresolved request across exit and reentry without aborting the new consumer", async () => {
    let finish!: (value: unknown) => void;
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const context = createContext({
      rpc: { call },
      connection: {
        status: "connected",
        presence: "online",
        tier: "full",
        capabilities: { sessionIdentity: true },
      },
    });
    mocks.context = context;
    await renderScreen("codexapp-imported");
    await act(async () => root.render(null));
    await renderScreen("codexapp-imported");
    expect(call).toHaveBeenCalledOnce();
    expect(context.subscribeSession).not.toHaveBeenCalled();
    await act(async () => finish({ sessionId: "owner", managed: true }));
    expect(context.subscribeSession).toHaveBeenCalledOnce();
    expect(context.subscribeSession).toHaveBeenCalledWith("owner");
  });

  it("retries a failed identity exactly once when the same relay connection recovers", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("desktop is offline"))
      .mockResolvedValueOnce({ sessionId: "recovered-owner", managed: true });
    const context = createContext({
      rpc: { call },
      connection: {
        status: "connected",
        presence: "online",
        tier: "full",
        capabilities: { sessionIdentity: true },
      },
    });
    mocks.context = context;
    await renderScreen("codexapp-imported");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(context.subscribeSession).not.toHaveBeenCalled();

    mocks.context = {
      ...context,
      connection: { ...context.connection, presence: "offline" },
    };
    await renderScreen("codexapp-imported");
    expect(container.textContent).toContain("connection.reconnecting");
    expect(call).toHaveBeenCalledTimes(1);
    mocks.context = context;
    await renderScreen("codexapp-imported");
    await renderScreen("codexapp-imported");
    expect(call).toHaveBeenCalledTimes(2);
    expect(context.subscribeSession).toHaveBeenCalledOnce();
    expect(context.subscribeSession).toHaveBeenCalledWith("recovered-owner");
    expect(
      container.querySelector('[data-testid="chat-transcript"]')
    ).not.toBeNull();
  });

  it("cancels an offline identity attempt and rejects its late result after recovery", async () => {
    let finishOld!: (value: unknown) => void;
    const call = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            finishOld = done;
          })
      )
      .mockResolvedValueOnce({ sessionId: "new-owner", managed: true });
    const context = createContext({
      rpc: { call },
      connection: {
        status: "connected",
        presence: "online",
        tier: "full",
        capabilities: { sessionIdentity: true },
      },
    });
    mocks.context = context;
    await renderScreen("codexapp-imported");
    const signal = call.mock.calls[0][2] as AbortSignal;
    mocks.context = {
      ...context,
      connection: { ...context.connection, presence: "offline" },
    };
    await renderScreen("codexapp-imported");
    expect(signal.aborted).toBe(true);
    mocks.context = context;
    await renderScreen("codexapp-imported");
    await act(async () =>
      finishOld({ sessionId: "stale-owner", managed: true })
    );
    expect(context.subscribeSession).toHaveBeenCalledOnce();
    expect(context.subscribeSession).toHaveBeenCalledWith("new-owner");
    expect(context.sendMessage).not.toHaveBeenCalled();
  });

  it("offers provider-owned reconnect during identity loading and keeps a resolved chat readable offline", async () => {
    let resolve!: (value: unknown) => void;
    const call = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const context = createContext({
      rpc: { call },
      connection: {
        status: "connected",
        presence: "online",
        tier: "full",
        capabilities: { sessionIdentity: true },
      },
    });
    mocks.context = context;
    await renderScreen("codexapp-imported");
    await act(async () => container.querySelector("button")!.click());
    expect(context.retryConnection).toHaveBeenCalledOnce();
    expect(context.subscribeSession).not.toHaveBeenCalled();
    await act(async () => resolve({ sessionId: "owner", managed: true }));
    mocks.context = {
      ...context,
      connection: { ...context.connection, presence: "offline" },
    };
    await renderScreen("codexapp-imported");
    expect(
      container.querySelector('[data-testid="chat-transcript"]')
    ).not.toBeNull();
    expect(mocks.composerProps?.disabled).toBe(true);
    expect(context.subscribeSession).toHaveBeenCalledOnce();
    expect(context.subscribeSession).toHaveBeenCalledWith("owner");
  });

  it("does not mount a writable chat on resolution failure and supports explicit retry", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("ambiguous owner"))
      .mockResolvedValueOnce({ sessionId: "session-a", managed: false });
    mocks.context = createContext({
      rpc: { call },
      connection: {
        status: "connected",
        presence: "online",
        tier: "full",
        capabilities: { sessionIdentity: true },
      },
    });
    await renderScreen("codexapp-imported");
    expect(mocks.context.subscribeSession).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => container.querySelector("button")!.click());
    expect(mocks.context.subscribeSession).toHaveBeenCalledWith("session-a");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("ignores a previous connection's late identity response", async () => {
    let finishOld!: (value: unknown) => void;
    const connection = {
      status: "connected",
      presence: "online",
      tier: "full",
      capabilities: { sessionIdentity: true },
    };
    const subscribeSession = vi.fn().mockResolvedValue(undefined);
    mocks.context = createContext({
      connection,
      subscribeSession,
      rpc: {
        call: vi.fn(
          () =>
            new Promise((done) => {
              finishOld = done;
            })
        ),
      },
    });
    await renderScreen("codexapp-imported");
    mocks.context = createContext({
      connection,
      subscribeSession,
      rpc: {
        call: vi
          .fn()
          .mockResolvedValue({ sessionId: "new-owner", managed: true }),
      },
    });
    await renderScreen("codexapp-imported");
    await act(async () => finishOld({ sessionId: "old-owner", managed: true }));
    expect(subscribeSession).toHaveBeenCalledTimes(1);
    expect(subscribeSession).toHaveBeenLastCalledWith("new-owner");
  });

  it("keeps device read-only permission after resolving a managed mirror", async () => {
    mocks.context = createContext({
      rpc: {
        call: vi
          .fn()
          .mockResolvedValue({ sessionId: "managed", managed: true }),
      },
      connection: {
        status: "connected",
        presence: "online",
        tier: "read_only",
        capabilities: { sessionIdentity: true },
      },
    });
    await renderScreen("codexapp-imported");
    expect(mocks.context.subscribeSession).toHaveBeenCalledWith("managed");
    expect(mocks.composerProps?.disabled).toBe(true);
    expect(mocks.composerProps?.disabledReason).toBe("composerDeviceReadOnly");
    expect(mocks.context.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects malformed identity responses without falling back to the imported write path", async () => {
    mocks.context = createContext({
      rpc: {
        call: vi.fn().mockResolvedValue({ sessionId: "", managed: true }),
      },
      connection: {
        status: "connected",
        presence: "online",
        tier: "full",
        capabilities: { sessionIdentity: true },
      },
    });
    await renderScreen("codexapp-imported");
    expect(mocks.context.subscribeSession).not.toHaveBeenCalled();
    expect(mocks.context.sendMessage).not.toHaveBeenCalled();
    expect(mocks.composerProps).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("shows loading only until the current turn paints Agent output", async () => {
    await renderScreen();
    expect(mocks.transcriptProps?.waitingForAgent).toBe(true);

    mocks.context = createContext({
      transcriptItems: [
        OPTIMISTIC_USER,
        {
          id: "agent-turn-1",
          kind: "agent",
          text: "Working",
          streaming: true,
        } satisfies TranscriptItem,
      ],
    });
    await renderScreen();
    expect(mocks.transcriptProps?.waitingForAgent).toBe(false);

    mocks.context = createContext({
      sendStatus: {
        sessionId: "session-a",
        turnIntentId: "turn-1",
        phase: "failed",
      },
    });
    await renderScreen();
    expect(mocks.transcriptProps?.waitingForAgent).toBe(false);
  });
  it("marks only the successfully loaded current session; never loading/error/old-session or unsupported/offline views", async () => {
    const markVisited = vi.fn();
    for (const [phase, transcriptSessionId, online, supported, shouldMark] of [
      ["loading", "session-a", true, true, false],
      ["error", "session-a", true, true, false],
      ["ready", "previous-session", true, true, false],
      ["ready", "session-a", false, true, false],
      ["ready", "session-a", true, false, false],
      ["ready", "session-a", true, true, true],
      ["empty", "session-a", true, true, true],
    ]) {
      markVisited.mockClear();
      mocks.context = createContext({
        readStateSync: { markVisited },
        transcriptPhase: phase,
        transcriptSessionId,
        connection: {
          status: "connected",
          presence: online ? "online" : "offline",
          tier: "read_only",
          capabilities: { sessionReadState: supported },
        },
      });
      await renderScreen();
      expect(markVisited).toHaveBeenCalledTimes(shouldMark ? 1 : 0);
      if (shouldMark) expect(markVisited).toHaveBeenCalledWith("session-a");
    }
  });

  it.each([
    ["online", "full", false, undefined],
    ["offline", "full", true, "composerOffline"],
    ["online", "read_only", true, "composerDeviceReadOnly"],
    ["offline", "read_only", true, "composerDeviceReadOnly"],
  ])(
    "distinguishes %s connectivity from %s device permissions",
    async (presence, tier, disabled, reason) => {
      mocks.context = createContext({
        connection: { status: "connected", presence, tier },
      });
      await renderScreen();
      expect(mocks.composerProps?.disabled).toBe(disabled);
      expect(mocks.composerProps?.disabledReason).toBe(reason);
      if (reason) expect(container.textContent).toContain(reason);
      expect(mocks.context.sendMessage).not.toHaveBeenCalled();
    }
  );

  it("retains the imported-session restriction independently of full device access", async () => {
    await act(async () =>
      root.render(
        React.createElement(SessionChatScreen, {
          sessionId: "session-a",
          sessionName: "Imported",
          sendCapability: "read_only",
        })
      )
    );
    expect(mocks.composerProps?.disabled).toBe(true);
    expect(mocks.composerProps?.disabledReason).toBe("composerReadOnly");
  });

  it("keeps image scope stable offline and credential refresh, but changes it for another desktop or endpoint", async () => {
    const connection = {
      status: "connected",
      presence: "online",
      tier: "full",
      capabilities: { sessionImages: true },
    };
    const config = {
      desktopId: "desktop-a",
      wsUrl: "wss://relay.example/v1/mobile/ws?token=secret",
    };
    mocks.context = createContext({ connection, connectionConfig: config });
    await renderScreen();
    const scope = mocks.transcriptProps?.imageScope;
    expect(typeof mocks.transcriptProps?.loadImage).toBe("function");
    expect(String(scope)).not.toContain("secret");
    mocks.context = createContext({
      connection: { ...connection, presence: "offline" },
      connectionConfig: config,
    });
    await renderScreen();
    expect(mocks.transcriptProps?.loadImage).toBeUndefined();
    expect(mocks.transcriptProps?.imageScope).toBe(scope);
    mocks.context = createContext({
      connection,
      connectionConfig: {
        ...config,
        wsUrl: "wss://relay.example/v1/mobile/ws?ticket=new",
      },
    });
    await renderScreen();
    expect(mocks.transcriptProps?.imageScope).toBe(scope);
    mocks.context = createContext({
      connection,
      connectionConfig: { ...config, desktopId: "desktop-b" },
    });
    await renderScreen();
    expect(mocks.transcriptProps?.imageScope).not.toBe(scope);
    mocks.context = createContext({
      connection,
      connectionConfig: {
        ...config,
        wsUrl: "wss://other.example/v1/mobile/ws",
      },
    });
    await renderScreen();
    expect(mocks.transcriptProps?.imageScope).not.toBe(scope);
  });

  it("passes safe approval failure feedback into the active sheet and clears it on recovery", async () => {
    const activePermission = { sessionId: "session-a", requestId: "request-a" };
    mocks.context = createContext({ activePermission, permissionFailed: true });
    await renderScreen();
    expect(mocks.permissionProps?.open).toBe(true);
    expect(mocks.permissionProps?.error).toBe("permission.submitFailed");
    mocks.context = createContext({
      activePermission,
      permissionFailed: false,
    });
    await renderScreen();
    expect(mocks.permissionProps?.error).toBeUndefined();
  });
});

// @vitest-environment jsdom
import { Provider, createStore, useAtomValue } from "jotai";
import { act, createElement, useEffect, useMemo } from "react";
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

import type {
  AgentOrgRunMemberView,
  AgentOrgRunView,
} from "@src/api/tauri/agent";
import {
  activeSessionIdAtom,
  pipelineSessionClaimAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import { groupChatViewSessionIdAtom } from "@src/store/ui/chatPanel/displayPrefsAtoms";

import { useAgentOrgGroupChatController } from "./useAgentOrgGroupChatController";

const projectionMocks = vi.hoisted(() => ({
  useAgentOrgGroupProjection: vi.fn(() => ({
    runId: null,
    items: [],
    hasMore: false,
    loading: false,
    loadingOlder: false,
    error: null,
    refresh: vi.fn(async () => undefined),
    loadOlder: vi.fn(async () => undefined),
  })),
}));

const agentMocks = vi.hoisted(() => ({
  resumeAgentOrgRun: vi.fn(async () => undefined),
  sendAgentOrgGroupRootMessage: vi.fn(async () => undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/api/tauri/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@src/api/tauri/agent")>()),
  ...agentMocks,
}));

vi.mock("./agentOrgGroupProjectionStore", () => ({
  getAgentOrgGroupProjectionSnapshot: () => ({
    runId: null,
    items: [],
    hasMore: false,
    loading: false,
    loadingOlder: false,
    error: null,
  }),
  useAgentOrgGroupProjection: projectionMocks.useAgentOrgGroupProjection,
}));

const coordinator: AgentOrgRunMemberView = {
  memberId: "coordinator",
  name: "Coordinator",
  role: "Lead",
  agentId: "agent-coordinator",
  isCoordinator: true,
  writerCapable: true,
  sessionRuntime: {
    sessionId: "session-root",
    status: "running",
    updatedAt: "2026-09-13T00:00:00.000Z",
  },
  unreadInboxCount: 0,
  inboxActivityCount: 0,
  activeTaskCount: 0,
  pendingTaskCount: 0,
  inProgressTaskCount: 0,
  completedTaskCount: 0,
  queuedUserDirectedCount: 0,
  activity: null,
  intervention: null,
};

const worker: AgentOrgRunMemberView = {
  ...coordinator,
  memberId: "worker",
  name: "Worker",
  role: "Build",
  agentId: "agent-worker",
  isCoordinator: false,
  writerCapable: false,
  sessionRuntime: {
    sessionId: "session-worker",
    parentSessionId: "session-root",
    status: "idle",
    updatedAt: "2026-09-13T00:00:00.000Z",
  },
};

const runView = {
  context: {
    runId: "run-1",
    rootSessionId: "session-root",
  },
  runStatus: "running",
  members: [coordinator, worker],
} as AgentOrgRunView;

type Controller = ReturnType<typeof useAgentOrgGroupChatController>;

function Harness({
  surfaceSessionId,
  onReady,
}: {
  surfaceSessionId: string;
  onReady: (controller: Controller) => void;
}) {
  const pipelineSessionId = useAtomValue(activeSessionIdAtom);
  const currentMember = useMemo(
    () =>
      runView.members.find(
        (member) => member.sessionRuntime?.sessionId === pipelineSessionId
      ) ?? null,
    [pipelineSessionId]
  );
  const controller = useAgentOrgGroupChatController({
    sessionId: surfaceSessionId,
    agentOrgRunView: runView,
    currentAgentOrgMember: currentMember,
    refreshAgentOrgRunView: async () => undefined,
  });
  useEffect(() => onReady(controller), [controller, onReady]);
  return null;
}

describe("Agent Org Group surface navigation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;
  let controller: Controller | null;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    controller = null;
    store = createStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  function renderHarness(surfaceSessionId: string): void {
    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(Harness, {
            surfaceSessionId,
            onReady: (value) => {
              controller = value;
            },
          })
        )
      );
    });
  }

  it("switches a sidebar-opened Member to the Root-backed Group surface without moving the sidebar anchor", async () => {
    store.set(workstationActiveSessionIdAtom, "session-worker");
    store.set(activeSessionIdAtom, "session-worker");
    renderHarness("session-worker");

    expect(store.get(groupChatViewSessionIdAtom)).toBeNull();

    act(() => controller?.handleGroupChatViewToggle(true));

    expect(store.get(workstationActiveSessionIdAtom)).toBe("session-worker");
    expect(store.get(activeSessionIdAtom)).toBe("session-root");
    expect(store.get(pipelineSessionClaimAtom)).toEqual({
      sessionId: "session-root",
      workstationSessionId: "session-worker",
    });
    expect(store.get(groupChatViewSessionIdAtom)).toBe("session-worker");
    expect(controller?.groupChatViewActive).toBe(true);
    expect(controller?.queueSessionId).toBe("session-root");
    expect(projectionMocks.useAgentOrgGroupProjection).toHaveBeenLastCalledWith(
      "run-1",
      "session-root",
      true
    );

    await act(async () => controller?.handleResumeGroupChatRun());
    expect(agentMocks.resumeAgentOrgRun).toHaveBeenCalledWith("session-root");

    await act(async () => {
      await controller?.handleGroupChatSubmitOverride({
        displayText: "Continue the Team work",
        agentContent: "Continue the Team work",
        memberMentions: [],
      });
    });
    expect(agentMocks.sendAgentOrgGroupRootMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-root",
        content: "Continue the Team work",
      })
    );
  });

  it("does not pre-arm Group when a direct Member surface first materializes", () => {
    store.set(workstationActiveSessionIdAtom, "session-worker");
    store.set(activeSessionIdAtom, "session-worker");
    renderHarness("session-worker");

    act(() => store.set(activeSessionIdAtom, "session-root"));

    expect(store.get(groupChatViewSessionIdAtom)).toBeNull();
    expect(controller?.groupChatViewActive).toBe(false);
  });
});

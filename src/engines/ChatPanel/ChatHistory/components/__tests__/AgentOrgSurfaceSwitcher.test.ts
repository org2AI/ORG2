// @vitest-environment jsdom
import React, { act, useState } from "react";
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

import type { AgentOrgRunMemberView } from "@src/api/tauri/agent";

import AgentOrgSurfaceSwitcher from "../AgentOrgSurfaceSwitcher";

const dropdownEngineTestState = vi.hoisted(() => ({ maxHeight: 300 }));

vi.mock("react-i18next", async () => {
  const { default: sessions } =
    await import("@src/i18n/locales/en/sessions.json");
  const labels: Record<string, string> = {
    "sessions:groupChat.triggerLabel": sessions.groupChat.triggerLabel,
    "sessions:planner.agentOrgOverview.title":
      sessions.planner.agentOrgOverview.title,
    "sessions:planner.agentOrgMemberStatus.noTasks":
      sessions.planner.agentOrgMemberStatus.noTasks,
  };
  return { useTranslation: () => ({ t: (key: string) => labels[key] ?? key }) };
});

vi.mock("@src/hooks/dropdown", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    useDropdownEngine: ({ disabled = false }: { disabled?: boolean }) => {
      const [isOpen, setIsOpen] = ReactModule.useState(false);
      const triggerRef = ReactModule.useRef<HTMLButtonElement>(null);
      const panelRef = ReactModule.useRef<HTMLDivElement>(null);
      return {
        isOpen,
        isPositioned: isOpen,
        setIsOpen: (open: boolean) => {
          if (!disabled) setIsOpen(open);
        },
        close: () => setIsOpen(false),
        triggerRef,
        panelRef,
        panelPosition: {
          top: 10,
          left: 10,
          width: 180,
          maxHeight: dropdownEngineTestState.maxHeight,
        },
      };
    },
  };
});

const members: AgentOrgRunMemberView[] = [
  {
    memberId: "coordinator",
    name: "Team lead",
    role: "Lead",
    agentId: "lead-agent",
    isCoordinator: true,
    writerCapable: false,
    sessionRuntime: {
      sessionId: "coordinator-session",
      status: "running",
      updatedAt: "2026-09-13T00:00:00.000Z",
    },
    unreadInboxCount: 0,
    inboxActivityCount: 0,
    activeTaskCount: 1,
    pendingTaskCount: 0,
    inProgressTaskCount: 1,
    completedTaskCount: 0,
    queuedUserDirectedCount: 0,
  },
  {
    memberId: "reviewer",
    name: "Reviewer",
    role: "Review",
    agentId: "review-agent",
    isCoordinator: false,
    writerCapable: true,
    sessionRuntime: {
      sessionId: "reviewer-session",
      status: "idle",
      updatedAt: "2026-09-13T00:00:00.000Z",
    },
    unreadInboxCount: 0,
    inboxActivityCount: 0,
    activeTaskCount: 0,
    pendingTaskCount: 0,
    inProgressTaskCount: 0,
    completedTaskCount: 0,
    queuedUserDirectedCount: 0,
  },
  {
    memberId: "implementer",
    name: "Implementer",
    role: "Build",
    agentId: "build-agent",
    isCoordinator: false,
    writerCapable: false,
    sessionRuntime: {
      sessionId: "implementer-session",
      status: "failed",
      updatedAt: "2026-09-13T00:00:00.000Z",
    },
    unreadInboxCount: 0,
    inboxActivityCount: 0,
    activeTaskCount: 1,
    pendingTaskCount: 0,
    inProgressTaskCount: 0,
    completedTaskCount: 0,
    queuedUserDirectedCount: 0,
  },
  {
    memberId: "not-started",
    name: "Not started",
    role: "Wait",
    agentId: "waiting-agent",
    isCoordinator: false,
    writerCapable: false,
    sessionRuntime: null,
    unreadInboxCount: 0,
    inboxActivityCount: 0,
    activeTaskCount: 0,
    pendingTaskCount: 0,
    inProgressTaskCount: 0,
    completedTaskCount: 0,
    queuedUserDirectedCount: 0,
  },
];

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("AgentOrgSurfaceSwitcher", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onMemberSelect = vi.fn();
  const onGroupChatToggle = vi.fn();
  const onCloseSiblingMenu = vi.fn();
  const onRunViewRefresh = vi.fn(async (): Promise<void> => undefined);

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    dropdownEngineTestState.maxHeight = 300;
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

  async function renderSwitcher({
    groupChatActive = false,
    initiallyOverviewOpen = false,
    renderedMembers = members,
  }: {
    groupChatActive?: boolean;
    initiallyOverviewOpen?: boolean;
    renderedMembers?: AgentOrgRunMemberView[];
  } = {}) {
    function Harness() {
      const [overviewOpen, setOverviewOpen] = useState(initiallyOverviewOpen);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(AgentOrgSurfaceSwitcher, {
          currentMemberId: groupChatActive ? null : "coordinator",
          currentMemberName: groupChatActive ? null : "Team lead",
          members: renderedMembers,
          overviewAvailable: true,
          overviewOpen,
          setOverviewOpen,
          onMemberSelect,
          onRunViewRefresh,
          groupChatActive,
          groupChatAvailable: true,
          onGroupChatToggle,
          onCloseSiblingMenu,
        }),
        React.createElement(
          "output",
          { "data-testid": "overview-state" },
          overviewOpen ? "open" : "closed"
        )
      );
    }

    await act(async () => root.render(React.createElement(Harness)));
  }

  it("puts the localized Team Overview control first with the shared icon and soft selected state", async () => {
    await renderSwitcher();

    const switcher = container.querySelector(
      '[data-testid="agent-org-surface-switcher"]'
    );
    const overview = container.querySelector<HTMLButtonElement>(
      '[data-testid="agent-org-overview-trigger"]'
    );

    expect(switcher?.querySelector("button")).toBe(overview);
    expect(overview?.textContent).toContain("Team Overview");
    expect(
      overview?.querySelector('[data-icon="hierarchy-circle"]')
    ).not.toBeNull();
    expect(overview?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => overview?.click());

    expect(overview?.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector('[data-testid="overview-state"]')?.textContent
    ).toBe("open");
  });

  it("orders Group chat, Coordinator and runtime Members while preserving status and writer metadata", async () => {
    await renderSwitcher();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="agent-org-member-switcher-trigger"]'
    );

    await act(async () => trigger?.click());

    const rows = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(rows.map((row) => row.textContent)).toEqual([
      "Group chat",
      "Coordinatorsessions:planner.agentOrgMemberStatus.running",
      "Reviewersessions:planner.agentOrgIntervention.writerBadgeNo tasks",
      "Implementersessions:planner.agentOrgMemberStatus.failed",
    ]);
    expect(document.body.textContent).not.toContain("Not started");
    expect(onRunViewRefresh).toHaveBeenCalledTimes(1);
  });

  it("constrains both the panel and its scrollable member list to the available viewport height", async () => {
    dropdownEngineTestState.maxHeight = 120;
    const additionalMembers = Array.from({ length: 8 }, (_, index) => ({
      ...members[2],
      memberId: `additional-${index}`,
      name: `Additional ${index}`,
      agentId: `additional-agent-${index}`,
      sessionRuntime: {
        ...members[2].sessionRuntime!,
        sessionId: `additional-session-${index}`,
      },
    }));
    const renderedMembers = [...members, ...additionalMembers];
    const lastMember = additionalMembers.at(-1)!;

    await renderSwitcher({ renderedMembers });
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="agent-org-member-switcher-trigger"]'
    );
    await act(async () => trigger?.click());

    const panel = document.querySelector<HTMLElement>('[role="menu"]');
    const options = panel?.firstElementChild as HTMLElement | null;
    expect(panel?.style.maxHeight).toBe("120px");
    expect(options?.style.maxHeight).toBe("120px");
    expect(options?.classList.contains("overflow-y-auto")).toBe(true);

    const lastOption = document.querySelector<HTMLButtonElement>(
      `[data-testid="agent-org-member-switcher-option-${lastMember.memberId}"]`
    );
    await act(async () => lastOption?.click());
    expect(onMemberSelect).toHaveBeenCalledWith(lastMember);
  });

  it("allows Group selection while the menu refresh is still in flight", async () => {
    let finishRefresh!: () => void;
    onRunViewRefresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        })
    );

    await renderSwitcher();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="agent-org-member-switcher-trigger"]'
    );
    await act(async () => trigger?.click());

    const groupOption = document.querySelector<HTMLButtonElement>(
      '[data-testid="agent-org-group-chat-toggle"]'
    );
    await act(async () => groupOption?.click());

    expect(onRunViewRefresh).toHaveBeenCalledTimes(1);
    expect(onGroupChatToggle).toHaveBeenCalledWith(true);
    finishRefresh();
  });

  it("closes Overview when the page selector opens and exits Group before selecting a Member", async () => {
    await renderSwitcher({
      groupChatActive: true,
      initiallyOverviewOpen: true,
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="agent-org-member-switcher-trigger"]'
    );

    await act(async () => trigger?.click());
    expect(
      container.querySelector('[data-testid="overview-state"]')?.textContent
    ).toBe("closed");

    const reviewer = document.querySelector<HTMLButtonElement>(
      '[data-testid="agent-org-member-switcher-option-reviewer"]'
    );
    await act(async () => reviewer?.click());

    expect(onGroupChatToggle).toHaveBeenCalledWith(false);
    expect(onMemberSelect).toHaveBeenCalledWith(members[1]);
    expect(onGroupChatToggle.mock.invocationCallOrder[0]).toBeLessThan(
      onMemberSelect.mock.invocationCallOrder[0]
    );
  });
});

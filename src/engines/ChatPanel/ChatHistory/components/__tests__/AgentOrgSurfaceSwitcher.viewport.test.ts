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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

function member(index: number): AgentOrgRunMemberView {
  const isCoordinator = index === 0;
  return {
    memberId: isCoordinator ? "coordinator" : `member-${index}`,
    name: isCoordinator ? "Team lead" : `Member ${index}`,
    role: isCoordinator ? "Lead" : "Implement",
    agentId: `agent-${index}`,
    isCoordinator,
    writerCapable: false,
    sessionRuntime: {
      sessionId: isCoordinator ? "root-session" : `member-session-${index}`,
      status: "running",
      updatedAt: "2026-09-15T00:00:00.000Z",
    },
    unreadInboxCount: 0,
    inboxActivityCount: 0,
    activeTaskCount: 1,
    pendingTaskCount: 0,
    inProgressTaskCount: 1,
    completedTaskCount: 0,
    queuedUserDirectedCount: 0,
  };
}

function rect({
  left = 0,
  top = 0,
  width = 0,
  height = 0,
}: {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("AgentOrgSurfaceSwitcher viewport behavior", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView;
  const onMemberSelect = vi.fn();
  const onGroupChatToggle = vi.fn();
  const scrollIntoView = vi.fn();

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("innerWidth", 400);
    vi.stubGlobal("innerHeight", 220);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (
          this.getAttribute("data-testid") ===
          "agent-org-member-switcher-trigger"
        ) {
          return rect({ left: 20, top: 52, width: 200, height: 28 });
        }
        return rect({ left: 20, top: 84, width: 200, height: 0 });
      }
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: originalScrollIntoView,
    });
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("uses the real viewport budget and keyboard-scrolls to the last member", async () => {
    const members = Array.from({ length: 10 }, (_, index) => member(index));

    function Harness() {
      const [overviewOpen, setOverviewOpen] = useState(false);
      return React.createElement(AgentOrgSurfaceSwitcher, {
        currentMemberId: "coordinator",
        currentMemberName: "Team lead",
        members,
        overviewAvailable: true,
        overviewOpen,
        setOverviewOpen,
        onMemberSelect,
        onRunViewRefresh: async () => undefined,
        groupChatAvailable: true,
        onGroupChatToggle,
      });
    }

    await act(async () => root.render(React.createElement(Harness)));
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="agent-org-member-switcher-trigger"]'
    );
    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    const panel = document.querySelector<HTMLElement>('[role="menu"]');
    const options = panel?.firstElementChild as HTMLElement | null;
    // 220px viewport - 80px trigger bottom - 4px gap - 8px viewport padding.
    expect(panel?.style.maxHeight).toBe("128px");
    expect(options?.style.maxHeight).toBe("128px");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true })
      );
    });
    const lastOption = document.querySelector<HTMLButtonElement>(
      '[data-testid="agent-org-member-switcher-option-member-9"]'
    );
    expect(lastOption?.getAttribute("data-dropdown-keyboard-highlight")).toBe(
      "true"
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    });
    expect(onMemberSelect).toHaveBeenCalledWith(members[9]);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

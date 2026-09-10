// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSidebarSessionById } from "@src/store/session";
import { createHookLifecycleHarness } from "@src/test/hookLifecycleHarness";

import { useWorkstationSidebarRevealNavigationEffects } from "./sidebarConnector.revealNavigationEffects";

vi.mock("@src/store/session", () => ({
  loadSidebarSessionById: vi.fn(async () => ({ session_id: "loaded" })),
}));
vi.mock("./useSidebarOrgScope", () => ({
  buildCloudOrgSelectorValue: (id: string) => `cloud:${id}`,
}));

type Props = Parameters<typeof useWorkstationSidebarRevealNavigationEffects>[0];
const harness = createHookLifecycleHarness(
  useWorkstationSidebarRevealNavigationEffects
);
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const props = (): Props => ({
  sessionSidebarRevealRequest: null,
  setSidebarCollapsed: vi.fn(),
  setActiveViewKey: vi.fn(),
  setSelectedOrgId: vi.fn(),
  setExpandedSubagentParentIds: vi.fn(),
  activeSessionSidebarRevealRequest: null,
  revealCandidateMenuItems: [],
  setCollapsedSectionIds: vi.fn(),
});
const request = (id: number) => ({
  sessionId: `child-${id}`,
  parentSessionId: `parent-${id}`,
  cloudOrgId: `org-${id}`,
  requestId: id,
  issuedAt: id,
});

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  vi.mocked(loadSidebarSessionById).mockClear();
});
afterEach(async () => {
  await harness.unmount();
  vi.restoreAllMocks();
});

describe("session reveal view lifecycle", () => {
  it("applies only the latest reveal's view and org after a request is replaced", async () => {
    const callbacks = props();
    await harness.render({
      ...callbacks,
      sessionSidebarRevealRequest: request(1),
    });
    await harness.render({
      ...callbacks,
      sessionSidebarRevealRequest: request(2),
    });
    expect(frames.size).toBe(1);
    for (const callback of frames.values()) callback(0);
    expect(callbacks.setActiveViewKey).toHaveBeenCalledWith("sessions");
    expect(callbacks.setActiveViewKey).toHaveBeenCalledTimes(1);
    expect(callbacks.setSelectedOrgId).toHaveBeenCalledTimes(1);
    expect(callbacks.setSelectedOrgId).toHaveBeenCalledWith("cloud:org-2");
    expect(callbacks.setSidebarCollapsed).toHaveBeenCalledWith(false);
    expect(loadSidebarSessionById).toHaveBeenCalledWith("parent-2");
    expect(loadSidebarSessionById).toHaveBeenCalledWith("child-2");
    const update = vi.mocked(callbacks.setExpandedSubagentParentIds).mock
      .calls[0][0];
    expect(update(new Set(["existing"]))).toEqual(
      new Set(["existing", "parent-2"])
    );
  });

  it("cancels pending view changes on unmount and schedules nothing without a request", async () => {
    const callbacks = props();
    await harness.render(callbacks);
    expect(frames.size).toBe(0);
    expect(loadSidebarSessionById).not.toHaveBeenCalled();
    await harness.render({
      ...callbacks,
      sessionSidebarRevealRequest: request(1),
    });
    await harness.unmount();
    expect(frames.size).toBe(0);
    expect(callbacks.setActiveViewKey).not.toHaveBeenCalled();
    expect(callbacks.setSelectedOrgId).not.toHaveBeenCalled();
  });
});

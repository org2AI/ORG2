import { beforeEach, describe, expect, it, vi } from "vitest";

const loads = vi.hoisted(() => ({
  settings: vi.fn(),
  agents: vi.fn(),
  role: vi.fn(),
}));
vi.mock("@src/modules/MainApp/Settings/SettingsSlot", () => {
  loads.settings();
  return {};
});
vi.mock("@src/modules/MainApp/AgentOrgs", () => {
  loads.agents();
  return {};
});
vi.mock("@src/modules/MainApp/MyRole", () => {
  loads.role();
  return {};
});

describe("Settings route preloading", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });
  it("ignores lookalike route prefixes", async () => {
    const { preloadRouteByPath } = await import("./preload");
    preloadRouteByPath("/orgii/app/settings-old/general");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loads.settings).not.toHaveBeenCalled();
  });
  it("warms Settings modules across multiple paths", async () => {
    const { preloadRouteByPath } = await import("./preload");
    preloadRouteByPath("/orgii/app/settings/general");
    preloadRouteByPath("/orgii/app/settings/appearance?tab=app");
    await vi.waitFor(() => expect(loads.settings).toHaveBeenCalledOnce());
    expect(loads.agents).toHaveBeenCalledOnce();
    expect(loads.role).toHaveBeenCalledOnce();
  });
});

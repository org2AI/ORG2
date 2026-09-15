import { beforeEach, expect, it, vi } from "vitest";

import { prepareLaunch } from "./launch";

const api = vi.hoisted(() => ({
  stat: vi.fn(),
  agents: vi.fn(),
  config: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ stat: api.stat }));
vi.mock("@src/api/services/availableAgents", () => ({
  loadAvailableAgents: api.agents,
}));
vi.mock("@src/api/tauri/rpc/invoke", async (load) => ({
  ...(await load<typeof import("@src/api/tauri/rpc/invoke")>()),
  typedInvoke: api.invoke,
}));
vi.mock("./rpc", () => ({ loadConfig: api.config }));
const connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_one",
  target: "claude-code" as const,
};
const config = {
  mode: "orgii_managed",
  conflict: false,
  selectedKeyId: "market:selection",
  selectedModel: "model-a",
};
const launch = (active = () => true) =>
  prepareLaunch(
    connection,
    "market:selection",
    "model-a",
    "/project with spaces",
    active
  );
beforeEach(() => {
  vi.resetAllMocks();
  api.stat.mockResolvedValue({ isDirectory: true });
  api.agents.mockResolvedValue([
    { name: "claude_code", installed: true, command: "claude" },
  ]);
  api.config.mockResolvedValue(config);
  api.invoke.mockResolvedValue(null);
});
it("opens the independently owned client with the selected scope and no credentials in IPC", async () => {
  await launch();
  expect(api.invoke).toHaveBeenCalledWith(expect.anything(), {
    agent: "claude_code",
    selection: "market:selection",
    model: "model-a",
    folder: "/project with spaces",
  });
});
it.each([
  { ...config, conflict: true },
  { ...config, selectedKeyId: "market:other" },
  { ...config, selectedModel: "other" },
  { ...config, mode: "default" },
])("refuses changed configuration before launching: %j", async (changed) => {
  api.config.mockResolvedValue(changed);
  await expect(launch()).rejects.toThrow();
  expect(api.invoke).not.toHaveBeenCalled();
});
it("does not launch after the dialog closes while checks are in flight", async () => {
  let active = true;
  api.config.mockImplementation(async () => {
    active = false;
    return config;
  });
  await expect(launch(() => active)).rejects.toThrow();
  expect(api.invoke).not.toHaveBeenCalled();
});
it("requires an installed client and directory", async () => {
  api.agents.mockResolvedValue([]);
  await expect(launch()).rejects.toThrow("clientMissing");
  api.stat.mockResolvedValue({ isDirectory: false });
  await expect(launch()).rejects.toThrow("launchFailed");
  expect(api.invoke).not.toHaveBeenCalled();
});
it("propagates native launch failure without fallback", async () => {
  api.invoke.mockRejectedValue(new Error("launch rejected"));
  await expect(launch()).rejects.toThrow("launch rejected");
  expect(api.invoke).toHaveBeenCalledOnce();
});

it("opens Desktop without requiring the Claude CLI to be installed", async () => {
  api.agents.mockResolvedValue([]);
  api.config.mockResolvedValue({ ...config, mode: "direct" });
  await prepareLaunch(
    { ...connection, target: "claude-app" },
    "market:selection",
    "model-a",
    "/project with spaces",
    () => true
  );
  expect(api.agents).not.toHaveBeenCalled();
  expect(api.invoke).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ agent: "claude_desktop" })
  );
});

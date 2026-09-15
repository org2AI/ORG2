// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import Org2SessionDialog from "./Org2SessionDialog";

const api = vi.hoisted(() => ({
  entries: vi.fn(),
  prepare: vi.fn(),
  disconnect: vi.fn(),
  folder: vi.fn(),
  agents: vi.fn(),
  launch: vi.fn(),
  hydrate: vi.fn(),
  tab: vi.fn(),
  navigate: vi.fn(),
  show: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./rpc", () => ({
  loadEntries: api.entries,
  prepareSessionSource: api.prepare,
  disconnectConfig: api.disconnect,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: api.folder }));
vi.mock("@src/api/services/availableAgents", () => ({
  loadAvailableAgents: api.agents,
}));
vi.mock("@src/api/tauri/agent/session", () => ({ sessionLaunch: api.launch }));
vi.mock("@src/store/session/sessionAtom/exactSessionLoad", () => ({
  loadSidebarSessionById: api.hydrate,
}));
vi.mock("@src/store/chatPanel/chatPanelTabOpen/session", () => ({
  openOrFocusSessionInChatPanelTabAtom: {},
}));
vi.mock("jotai", async (original) => ({
  ...(await original<object>()),
  useSetAtom: () => api.tab,
}));
vi.mock("@src/hooks/navigation/useAppNavigate", () => ({
  useAppNavigate: () => api.navigate,
}));
vi.mock("@src/engines/ChatPanel/hooks/useChatPanelNavigationActions", () => ({
  useChatPanelNavigationActions: () => ({ showSessionSurface: api.show }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root, container: HTMLDivElement;
const connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_fixture",
  target: "org2" as const,
};
const entry = {
  entitlement_id: "ent_one",
  service_id: "svc_one",
  service_name: "Purchased service",
  models: ["ignore-unscoped"],
  models_by_agent: { claude: ["claude-fixture"], codex: ["codex-fixture"] },
  status: "active",
  expires_at: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.entries.mockResolvedValue([entry]);
  api.folder.mockResolvedValue("/workspace");
  api.agents.mockResolvedValue([{ name: "claude_code", installed: true }]);
  api.prepare.mockResolvedValue("market:public-selection");
  api.launch.mockResolvedValue({
    sessionId: "cli-fixture",
    name: "Purchased service",
    workspacePath: "/workspace",
  });
  api.hydrate.mockResolvedValue({ session_id: "cli-fixture" });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const button = (key: string) =>
  [...document.querySelectorAll("button")].find(
    (node) => node.textContent === `marketConnection.${key}`
  ) as HTMLButtonElement;
const render = () =>
  act(async () =>
    root.render(
      createElement(Org2SessionDialog, { connection, onClose: api.close })
    )
  );
const click = (key: string) => act(async () => button(key).click());
it("opens a normal empty bound session after native capability validation", async () => {
  await render();
  await click("openWorkspace");
  expect(api.prepare).toHaveBeenCalledWith(
    connection,
    "ent_one",
    "claude_code",
    "claude-fixture"
  );
  expect(api.launch).toHaveBeenCalledWith({
    category: "cli_agent",
    content: "",
    platform: "claude_code",
    credentialSource: "market:public-selection",
    model: "claude-fixture",
    workspacePath: "/workspace",
    isolate: false,
    name: "Purchased service",
  });
  expect(api.hydrate).toHaveBeenCalledWith("cli-fixture");
  expect(api.tab).toHaveBeenCalledWith({
    sessionId: "cli-fixture",
    sessionName: "Purchased service",
    repoPath: "/workspace",
  });
  expect(api.close).toHaveBeenCalledOnce();
});
it("retries hydration of the same persisted session without creating another", async () => {
  api.hydrate.mockRejectedValueOnce(Error("offline"));
  await render();
  await click("openWorkspace");
  expect(api.tab).not.toHaveBeenCalled();
  await click("openWorkspace");
  expect(api.launch).toHaveBeenCalledOnce();
  expect(api.folder).toHaveBeenCalledOnce();
  expect(api.hydrate).toHaveBeenCalledTimes(2);
  expect(api.tab).toHaveBeenCalledOnce();
});
it("does not create a session when authorization validation fails", async () => {
  api.prepare.mockRejectedValue(Error("revoked"));
  await render();
  await click("openWorkspace");
  expect(api.launch).not.toHaveBeenCalled();
  expect(api.tab).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("marketConnection.launchFailed");
});
it("canceling the folder picker performs no authorization or session creation", async () => {
  api.folder.mockResolvedValue(null);
  await render();
  await click("openWorkspace");
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.launch).not.toHaveBeenCalled();
});
it("preserves disconnect when remote purchases fail", async () => {
  api.entries.mockRejectedValue(Error("offline"));
  await render();
  expect(button("openWorkspace").disabled).toBe(true);
  expect(document.body.textContent).not.toContain(
    "marketConnection.noPurchases"
  );
  await click("disconnect");
  expect(api.disconnect).toHaveBeenCalledWith(connection);
});
it("blocks opening a session when the selected engine is not installed", async () => {
  api.agents.mockResolvedValue([]);
  await render();
  await click("openWorkspace");
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.launch).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("marketConnection.clientMissing");
});

it("uses the purchased Codex engine capability instead of the unscoped model list", async () => {
  api.entries.mockResolvedValue([
    { ...entry, models_by_agent: { claude: [], codex: ["codex-fixture"] } },
  ]);
  api.agents.mockResolvedValue([{ name: "codex", installed: true }]);
  await render();
  await click("openWorkspace");
  expect(api.prepare).toHaveBeenCalledWith(
    connection,
    "ent_one",
    "codex",
    "codex-fixture"
  );
  expect(api.launch).toHaveBeenCalledWith(
    expect.objectContaining({
      platform: "codex",
      model: "codex-fixture",
      content: "",
    })
  );
});

it("does not launch after the dialog unmounts during authorization validation", async () => {
  let resolve!: (key: string) => void;
  api.prepare.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    })
  );
  await render();
  await click("openWorkspace");
  await act(async () => root.render(null));
  await act(async () => resolve("market:selection"));
  expect(api.launch).not.toHaveBeenCalled();
});

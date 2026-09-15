// @vitest-environment jsdom
import { Fragment, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ConnectionHost from "./ConnectionHost";
import ConnectionSettings from "./ConnectionSettings";

const api = vi.hoisted(() => ({
  load: vi.fn(),
  entries: vi.fn(),
  config: vi.fn(),
  disconnect: vi.fn(),
  link: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./rpc", async (original) => ({
  ...(await original<typeof import("./rpc")>()),
  loadConnections: api.load,
  loadEntries: api.entries,
  loadConfig: api.config,
  disconnectConfig: api.disconnect,
}));
vi.mock("./deepLink", () => ({ handleMarketConnectionUrl: api.link }));
vi.mock("./SellerDialog", () => ({ default: () => null }));
vi.mock("./WorkspaceLaunch", () => ({ default: () => null }));

const connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_recovery",
  target: "codex" as const,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.load.mockResolvedValue({
    enabled: true,
    connections: [{ ...connection, phase: "reauthorization_required" }],
  });
  api.entries.mockRejectedValue(new Error("offline"));
  api.config.mockResolvedValue({
    agentName: "codex",
    supported: true,
    mode: "orgii_managed",
    hasDefaultBackup: true,
    conflict: false,
    selectedProvider: "market",
    selectedModel: "test-model",
    targetFiles: [],
    selectedKeyId:
      "market:" +
      Buffer.from(
        JSON.stringify({ metadata: connection, entitlement_id: "ent_saved" })
      ).toString("base64url"),
  });
  api.disconnect.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === label
  );
const render = async () => {
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(ConnectionHost),
        createElement(ConnectionSettings, { agentName: "codex" })
      )
    )
  );
};
it("opens local recovery from a missing-grant settings row and disconnects offline without browser authorization", async () => {
  // Resolve the lazy module before clicking; it remains the real dialog under test.
  await import("./ConnectionDialog");
  await render();
  expect(button("marketConnection.reauthorize")).toBeDefined();
  await act(async () => button("marketConnection.manage")!.click());
  expect(button("marketConnection.disconnect")).toBeDefined();
  expect(api.link).not.toHaveBeenCalled();
  api.load.mockResolvedValue({ enabled: true, connections: [] });
  await act(async () => button("marketConnection.disconnect")!.click());
  expect(api.disconnect).toHaveBeenCalledWith(connection);
  expect(button("marketConnection.manage")).toBeUndefined();
  expect(button("marketConnection.disconnect")).toBeUndefined();
});
it("starts browser authorization only when explicitly requested", async () => {
  await render();
  await act(async () => button("marketConnection.reauthorize")!.click());
  expect(api.link).toHaveBeenCalledWith(
    "orgii://market/connect?workspace_id=ws_recovery&target=codex"
  );
  expect(api.entries).not.toHaveBeenCalled();
  expect(api.disconnect).not.toHaveBeenCalled();
});

it("removes an old connection after switching to an ordinary profile without remote purchases", async () => {
  api.config.mockResolvedValue({
    agentName: "codex",
    supported: true,
    mode: "orgii_managed",
    selectedProvider: "ordinary",
    selectedKeyId: "ordinary-account",
    targetFiles: [],
    conflict: false,
  });
  await render();
  await act(async () => button("marketConnection.manage")!.click());
  expect(button("marketConnection.disconnect")).toBeDefined();
  api.load.mockResolvedValue({ enabled: true, connections: [] });
  await act(async () => button("marketConnection.disconnect")!.click());
  expect(api.disconnect).toHaveBeenCalledWith(connection);
  expect(api.link).not.toHaveBeenCalled();
  expect(button("marketConnection.manage")).toBeUndefined();
});

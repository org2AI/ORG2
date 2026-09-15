// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ConnectionDialog from "./ConnectionDialog";

const api = vi.hoisted(() => ({
  entries: vi.fn(),
  config: vi.fn(),
  apply: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("./WorkspaceLaunch", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./rpc", () => ({
  loadEntries: api.entries,
  loadConfig: api.config,
  applyConfig: api.apply,
  disconnectConfig: api.disconnect,
}));

let root: Root, container: HTMLDivElement;
const connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_example",
  target: "codex" as const,
};
const config = {
  agentName: "codex",
  supported: true,
  mode: "default",
  hasDefaultBackup: false,
  conflict: false,
  targetFiles: [{ id: "config", currentHash: "before" }],
  selectedKeyId: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.entries.mockResolvedValue([
    {
      entitlement_id: "ent_one",
      service_id: "svc_one",
      service_name: "Purchased listing",
      models: ["claude-sonnet-4-6", "gpt-5.3-codex"],
      models_by_agent: {
        claude: ["claude-sonnet-4-6"],
        codex: ["gpt-5.3-codex"],
      },
      status: "active",
      expires_at: null,
    },
  ]);
  api.config.mockResolvedValue(config);
  api.apply.mockResolvedValue({
    ...config,
    mode: "orgii_managed",
    selectedProvider: "market",
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
function button(label: string) {
  return [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label)
  ) as HTMLButtonElement;
}
it("configures the purchased compatible model with captured file hashes and only reports configuration", async () => {
  await act(async () =>
    root.render(
      createElement(ConnectionDialog, { connection, onClose: () => {} })
    )
  );
  expect(button("marketConnection.configure").disabled).toBe(false);
  await act(async () => button("marketConnection.configure").click());
  expect(api.apply).toHaveBeenCalledWith(
    connection,
    "ent_one",
    "gpt-5.3-codex",
    { config: "before" }
  );
  expect(document.body.textContent).toContain("marketConnection.configured");
  expect(api.disconnect).not.toHaveBeenCalled();
  expect(button("marketConnection.disconnect")).toBeDefined();
});
it("blocks applying over externally modified configuration", async () => {
  api.config.mockResolvedValue({ ...config, conflict: true });
  await act(async () =>
    root.render(
      createElement(ConnectionDialog, { connection, onClose: () => {} })
    )
  );
  expect(button("marketConnection.configure").disabled).toBe(true);
  expect(document.body.textContent).toContain("marketConnection.conflict");
  expect(api.apply).not.toHaveBeenCalled();
});
it("ignores purchases with no models compatible with the selected client", async () => {
  const compatible = (await api.entries())[0];
  api.entries.mockResolvedValue([
    {
      ...compatible,
      entitlement_id: "ent_other",
      service_name: "Other client",
      models_by_agent: { claude: ["claude-sonnet-4-6"], codex: [] },
    },
    compatible,
  ]);
  await act(async () =>
    root.render(
      createElement(ConnectionDialog, { connection, onClose: () => {} })
    )
  );
  expect(button("marketConnection.configure").disabled).toBe(false);
  await act(async () => button("marketConnection.configure").click());
  expect(api.apply).toHaveBeenCalledWith(
    connection,
    "ent_one",
    "gpt-5.3-codex",
    { config: "before" }
  );
});
it("keeps ORG2 workspace launch separate from native app configuration", async () => {
  await act(async () =>
    root.render(
      createElement(ConnectionDialog, {
        connection: { ...connection, target: "org2" },
        onClose: () => {},
      })
    )
  );
  expect(document.body.textContent).toContain(
    "marketConnection.adapterPending"
  );
  expect(button("marketConnection.configure").disabled).toBe(true);
  expect(api.entries).not.toHaveBeenCalled();
});

it("reopens a matching saved profile as configured and disconnects its exact entitlement", async () => {
  const key =
    "market:" +
    Buffer.from(
      JSON.stringify({ metadata: connection, entitlement_id: "ent_one" })
    ).toString("base64url");
  api.config.mockResolvedValue({
    ...config,
    mode: "orgii_managed",
    selectedProvider: "market",
    selectedKeyId: key,
    selectedModel: "gpt-5.3-codex",
  });
  api.disconnect.mockResolvedValue(undefined);
  const close = vi.fn();
  await act(async () =>
    root.render(createElement(ConnectionDialog, { connection, onClose: close }))
  );
  expect(document.body.textContent).toContain("marketConnection.configured");
  await act(async () => button("marketConnection.disconnect").click());
  expect(api.disconnect).toHaveBeenCalledWith(connection);
  expect(close).toHaveBeenCalledOnce();
});

it.each(["offline", "pending", "expired"])(
  "keeps local disconnect available when purchases are %s",
  async (state) => {
    const key =
      "market:" +
      Buffer.from(
        JSON.stringify({ metadata: connection, entitlement_id: "ent_one" })
      ).toString("base64url");
    api.config.mockResolvedValue({
      ...config,
      mode: "orgii_managed",
      selectedProvider: "market",
      selectedKeyId: key,
      selectedModel: "gpt-test",
    });
    if (state === "offline")
      api.entries.mockRejectedValue(new Error("offline"));
    else if (state === "pending")
      api.entries.mockReturnValue(new Promise(() => {}));
    else api.entries.mockResolvedValue([]);
    api.disconnect.mockResolvedValue(undefined);
    await act(async () =>
      root.render(
        createElement(ConnectionDialog, { connection, onClose: () => {} })
      )
    );
    expect(button("marketConnection.disconnect").disabled).toBe(false);
    if (state === "expired")
      expect(document.body.textContent).toContain(
        "marketConnection.noPurchases"
      );
    else
      expect(document.body.textContent).not.toContain(
        "marketConnection.noPurchases"
      );
    expect(document.body.textContent).toContain(
      state === "offline"
        ? "marketConnection.purchasesFailed"
        : state === "pending"
          ? "marketConnection.loadingPurchases"
          : "marketConnection.noPurchases"
    );
    await act(async () => button("marketConnection.disconnect").click());
    expect(api.disconnect).toHaveBeenCalledWith(connection);
    expect(api.apply).not.toHaveBeenCalled();
  }
);

it.each(["org2"] as const)(
  "allows local cleanup for %s even before its launch adapter is available",
  async (target) => {
    const saved = { ...connection, target };
    const close = vi.fn();
    await act(async () =>
      root.render(
        createElement(ConnectionDialog, { connection: saved, onClose: close })
      )
    );
    expect(button("marketConnection.configure").disabled).toBe(true);
    expect(button("marketConnection.disconnect").disabled).toBe(false);
    await act(async () => button("marketConnection.disconnect").click());
    expect(api.disconnect).toHaveBeenCalledWith(saved);
    expect(api.config).not.toHaveBeenCalled();
    expect(api.entries).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  }
);

it("retries only remote purchases and distinguishes failure, loading and successful empty response", async () => {
  let finish!: (value: unknown[]) => void;
  api.entries
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
  await act(async () =>
    root.render(
      createElement(ConnectionDialog, { connection, onClose: () => {} })
    )
  );
  expect(document.body.textContent).toContain(
    "marketConnection.purchasesFailed"
  );
  expect(document.body.textContent).not.toContain(
    "marketConnection.noPurchases"
  );
  await act(async () => button("marketConnection.retryPurchases").click());
  expect(document.body.textContent).toContain(
    "marketConnection.loadingPurchases"
  );
  expect(document.body.textContent).not.toContain(
    "marketConnection.purchasesFailed"
  );
  expect(document.body.textContent).not.toContain(
    "marketConnection.noPurchases"
  );
  expect(button("marketConnection.disconnect").disabled).toBe(false);
  expect(api.config).toHaveBeenCalledOnce();
  await act(async () => finish([]));
  expect(document.body.textContent).toContain("marketConnection.noPurchases");
  expect(document.body.textContent).not.toContain(
    "marketConnection.loadingPurchases"
  );
  expect(api.entries).toHaveBeenCalledTimes(2);
});
it("ignores an older workspace purchase response after switching connections", async () => {
  let finish!: (value: unknown[]) => void;
  api.entries
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce([]);
  await act(async () =>
    root.render(
      createElement(ConnectionDialog, { connection, onClose: () => {} })
    )
  );
  await act(async () =>
    root.render(
      createElement(ConnectionDialog, {
        connection: { ...connection, workspace_id: "ws_other" },
        onClose: () => {},
      })
    )
  );
  await act(async () =>
    finish([
      {
        entitlement_id: "ent_stale",
        service_name: "Stale purchase",
        status: "active",
        expires_at: null,
        models_by_agent: { codex: ["stale-model"], claude: [] },
      },
    ])
  );
  expect(document.body.textContent).toContain("marketConnection.noPurchases");
  expect(document.body.textContent).not.toContain("Stale purchase");
  expect(button("marketConnection.configure").disabled).toBe(true);
});

it("configures Claude App using compatible purchased models", async () => {
  const desktop = { ...connection, target: "claude-app" as const };
  await act(async () =>
    root.render(
      createElement(ConnectionDialog, {
        connection: desktop,
        onClose: () => {},
      })
    )
  );
  expect(button("marketConnection.configure").disabled).toBe(false);
  await act(async () => button("marketConnection.configure").click());
  expect(api.apply).toHaveBeenCalledWith(
    desktop,
    "ent_one",
    "claude-sonnet-4-6",
    { config: "before" }
  );
});

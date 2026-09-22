// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { RpcError } from "@src/api/tauri/rpc/invoke";
import Message from "@src/components/Message";
import { signedInStore } from "@src/features/MarketConnect/identity.test-utils";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import AppConnectionPage from "./AppConnectionPage";

vi.mock("./ClaudeProfileEditor", () => ({ default: () => null }));
vi.mock("./HarnessConnectionEditor", () => ({ default: () => null }));

const configure = vi.fn();
const restore = vi.fn();
const open = vi.fn();
const openLocal = vi.fn();
let direct = false;
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: {
    agentOrgs: {
      connections: { openClient: (...args: unknown[]) => openLocal(...args) },
      managedConfig: {
        restoreDefault: (...args: unknown[]) => restore(...args),
      },
    },
  },
}));
const reload = vi.fn();
const refresh = vi.fn();
const refreshProfiles = vi.fn();
let profilesError: string | null = null;
let connected = false;
let conflict = false;
let overlay = false;
let installed = true;
const identity = "11111111-1111-7111-8111-111111111111";
const appliedSelection = (entitlementId: string) => {
  const encoded = btoa(
    JSON.stringify({
      metadata: {
        identity_user_id: identity,
        workspace_id: "ws_anchor",
        target: "org2",
      },
      workspace_id: "ws_purchase",
      entitlement_id: entitlementId,
    })
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `market:${encoded}`;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${values.index}:${values.count}` : key,
  }),
}));
vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => [
    {
      marketProfileId: "market:user:second",
      cliAgentType: "claude_code",
      modelId: "claude-b",
    },
  ],
}));
vi.mock(
  "@src/features/MarketConnect/externalAppBridge",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@src/features/MarketConnect/externalAppBridge")
    >()),
    configureExternalMarketCatalog: (...args: unknown[]) => configure(...args),
    restoreExternalMarketTarget: (...args: unknown[]) => restore(...args),
    isMarketManagedView: (view: {
      config?: { mode?: string; selectedKeyId?: string };
    }) =>
      Boolean(
        view?.config?.mode === "orgii_managed" &&
        view.config.selectedKeyId?.startsWith("market:")
      ),
  })
);
vi.mock("@src/features/MarketConnect/launch", () => ({
  openConfiguredMarketClient: (...args: unknown[]) => open(...args),
}));

const profiles = [
  {
    id: "market:user:first",
    label: "Same service",
    connection: {
      identity_user_id: identity,
      workspace_id: "ws_anchor",
      target: "org2",
    },
    entitlementWorkspaceId: "ws_purchase",
    entitlementId: "ent_first",
    serviceId: "service_first",
    modelsByAgent: { claude_code: ["claude-a"], codex: [] },
    expiresAt: null,
  },
  {
    id: "market:user:second",
    label: "Same service",
    connection: {
      identity_user_id: identity,
      workspace_id: "ws_anchor",
      target: "org2",
    },
    entitlementWorkspaceId: "ws_purchase",
    entitlementId: "ent_second",
    serviceId: "service_second",
    modelsByAgent: { claude_code: ["claude-b"], codex: ["gpt-b"] },
    expiresAt: null,
  },
];
vi.mock("@src/features/MarketConnect/marketProfiles", () => ({
  useMarketExecutionProfiles: () => ({
    profiles,
    loading: false,
    error: profilesError,
    refresh: refreshProfiles,
  }),
}));
vi.mock("./useHarnessConnection", () => ({
  refreshHarnessConnections: (...args: unknown[]) => refresh(...args),
  useHarnessConnection: () => ({
    view: {
      installed,
      config: {
        supported: true,
        mode: direct ? "direct" : connected ? "orgii_managed" : "default",
        conflict,
        overlay,
        selectedKeyId: direct
          ? "key-a"
          : connected
            ? appliedSelection("ent_second")
            : null,
        selectedModel: direct ? "model-a" : connected ? "claude-b" : null,
        targetFiles: overlay
          ? [
              {
                id: "settings",
                targetPath:
                  "/home/.orgii/cli-config-profiles/claude_code/overlay/settings.json",
                overlay: true,
                conflict: false,
              },
            ]
          : [],
      },
      choices: [{ keyId: "key-a", name: "My API", models: ["model-a"] }],
    },
    loading: false,
    error: null,
    reload,
  }),
}));
vi.mock("@src/components/Message", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  signedInStore(identity);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  connected = false;
  direct = false;
  openLocal.mockResolvedValue(null);
  profilesError = null;
  conflict = false;
  overlay = false;
  installed = true;
  configure.mockResolvedValue({});
  restore.mockResolvedValue({});
  open.mockResolvedValue({});
  reload.mockResolvedValue({ status: "updated" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(target: "claude_code" | "claude_desktop" | "codex") {
  await act(async () =>
    root.render(
      createElement(AppConnectionPage, {
        target,
        onConfigureAccounts: vi.fn(),
      })
    )
  );
}

function button(text: string) {
  return [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text
  ) as HTMLButtonElement;
}

it("selects provider first and keeps duplicate purchases as separate private connections", async () => {
  await render("claude_code");
  await act(async () => button("common:actions.configure").click());
  expect(container.textContent).toContain("harnessConnections.connection");
  expect(container.textContent).not.toContain("Same service");

  const marketProvider = [...container.querySelectorAll("button")].find(
    (item) =>
      item.textContent?.startsWith("harnessConnections.marketApps.provider")
  ) as HTMLButtonElement;
  await act(async () => marketProvider.click());
  const choices = [...container.querySelectorAll("button")].filter((item) =>
    item.textContent?.includes("Same service")
  );
  const [first, second] = choices;
  // A new client has no applied Package yet; both initial choices must be usable.
  expect(first.disabled).toBe(false);
  expect(second.disabled).toBe(false);
  expect(first.textContent).toContain("Same service");
  expect(second.textContent).toContain("Same service");
  expect(first.textContent).toContain(
    "harnessConnections.marketApps.workspaceNumber:1:2"
  );
  expect(second.textContent).toContain(
    "harnessConnections.marketApps.workspaceNumber:2:2"
  );
  expect(container.textContent).not.toMatch(/seller|email/i);

  await act(async () => first.click());
  // Stage both purchases without mutating the native app until Apply.
  await act(async () => second.click());
  expect(first.getAttribute("aria-pressed")).toBe("true");
  expect(second.getAttribute("aria-pressed")).toBe("true");
  expect(configure).not.toHaveBeenCalled();
  const defaultModel = container.querySelector<HTMLElement>(
    '[aria-label="harnessConnections.marketApps.defaultModel"]'
  );
  expect(defaultModel).not.toBeNull();
  expect(defaultModel?.textContent).toContain(
    "Same service · harnessConnections.marketApps.workspaceNumber:1:2 · claude-a"
  );
  const connect = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.startsWith("harnessConnections.apply")
  ) as HTMLButtonElement;
  await act(async () => connect.click());
  expect(configure).toHaveBeenCalledWith(
    profiles,
    "claude_code",
    profiles[0].id,
    "claude-a"
  );
  expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
    reload.mock.invocationCallOrder[0]
  );
});

it("opens Claude Code in a terminal and Desktop as an app", async () => {
  connected = true;
  await render("claude_code");
  expect(container.textContent).toContain(
    "harnessConnections.marketApps.workspaceNumber:2:2"
  );
  await act(async () =>
    button("harnessConnections.marketApps.openTerminal").click()
  );
  expect(open).toHaveBeenCalledWith(
    "claude_code",
    appliedSelection("ent_second"),
    "claude-b"
  );

  await act(async () =>
    root.render(
      createElement(AppConnectionPage, {
        target: "claude_desktop",
        onConfigureAccounts: vi.fn(),
      })
    )
  );
  expect(container.textContent).toContain("harnessConnections.marketApps.open");
  expect(container.textContent).not.toContain(
    "harnessConnections.marketApps.openTerminal"
  );
});

it("restores only the selected target app", async () => {
  connected = true;
  await render("codex");
  await act(async () => button("harnessConnections.restore").click());
  expect(restore).toHaveBeenCalledWith("codex");
});

it("explains an external edit detected during restore and refreshes its conflict state", async () => {
  connected = true;
  restore.mockImplementationOnce(async () => {
    conflict = true;
    throw new RpcError(
      "cli_config_restore_default",
      "restore failed",
      "Current CLI config was modified outside ORG2. Force restore to overwrite it."
    );
  });
  await render("claude_desktop");
  await act(async () => button("harnessConnections.restore").click());

  expect(Message.error).toHaveBeenCalledWith({
    content: "harnessConnections.conflict",
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledOnce();
  expect(button("harnessConnections.restore").disabled).toBe(true);
  expect(restore).toHaveBeenCalledExactlyOnceWith("claude_desktop");
  expect(Message.success).not.toHaveBeenCalled();
});

it.each([
  new RpcError("cli_config_restore_default", "restore failed", "private-token"),
  new RpcError(
    "cli_config_restore_default",
    "restore failed",
    "Current CLI config was modified outside ORG2. Force restore to overwrite it. private-token"
  ),
  new RpcError(
    "other_command",
    "restore failed",
    "Current CLI config was modified outside ORG2. Force restore to overwrite it."
  ),
])(
  "keeps unexpected restore failures private and never forces a retry (%#)",
  async (error) => {
    direct = true;
    restore.mockRejectedValueOnce(error);
    await render("claude_desktop");
    await act(async () => button("harnessConnections.restore").click());

    expect(Message.error).toHaveBeenCalledWith({
      content: "harnessConnections.marketApps.actionFailed",
    });
    expect(JSON.stringify(vi.mocked(Message.error).mock.calls)).not.toContain(
      "private-token"
    );
    expect(restore).toHaveBeenCalledExactlyOnceWith({
      agentName: "claude_desktop",
      force: false,
    });
    expect(reload).toHaveBeenCalledOnce();
    expect(Message.success).not.toHaveBeenCalled();
  }
);

it("describes the Claude Code overlay and offers disconnect instead of restore", async () => {
  connected = true;
  overlay = true;
  await render("claude_code");
  expect(container.textContent).toContain("harnessConnections.overlayHelp");
  expect(container.textContent).not.toContain("harnessConnections.conflict");
  expect(button("harnessConnections.restore")).toBeUndefined();
  await act(async () => button("harnessConnections.disconnect").click());
  expect(restore).toHaveBeenCalledWith("claude_code");
});

it("reports configuration conflicts without calling them unsupported versions", async () => {
  connected = true;
  conflict = true;
  await render("claude_code");
  expect(container.textContent).toContain("harnessConnections.conflict");
  expect(container.textContent).not.toContain(
    "harnessConnections.marketApps.unavailable"
  );
  expect(button("harnessConnections.restore").disabled).toBe(true);
});

it("can restore saved settings while signed out even when the client is no longer installed", async () => {
  getInstrumentedStore().set(org2CloudAuthAtom, null);
  connected = true;
  installed = false;
  await render("claude_desktop");
  expect(button("harnessConnections.restore").disabled).toBe(false);
  await act(async () => button("harnessConnections.restore").click());
  expect(restore).toHaveBeenCalledWith("claude_desktop");
});

it("offers a reload after a purchase lookup failure instead of claiming a missing key", async () => {
  connected = true;
  profilesError = "temporary_failure";
  await render("claude_code");
  await act(async () => button("common:actions.edit").click());
  const provider = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.startsWith("harnessConnections.marketApps.provider")
  )!;
  await act(async () => provider.click());
  await act(async () => button("harnessConnections.refresh").click());
  expect(refreshProfiles).toHaveBeenCalledOnce();
});

it("does not announce a stale native open after Cloud logout", async () => {
  connected = true;
  let finish!: () => void;
  open.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render("claude_code");
  await act(async () =>
    button("harnessConnections.marketApps.openTerminal").click()
  );
  expect(open).toHaveBeenCalledOnce();
  await act(async () => {
    getInstrumentedStore().set(org2CloudAuthAtom, null);
    finish();
  });
  expect(Message.success).not.toHaveBeenCalled();
  expect(Message.error).toHaveBeenCalledOnce();
  expect(Message.error).toHaveBeenCalledWith({
    content: "harnessConnections.marketApps.openFailed",
  });
});

it("opens a Direct Claude overlay without depending on a Market login or grant", async () => {
  getInstrumentedStore().set(org2CloudAuthAtom, null);
  direct = true;
  overlay = true;
  profilesError = "Market unavailable";
  await render("claude_code");
  const launch = button("harnessConnections.marketApps.openTerminal");
  expect(launch.disabled).toBe(false);
  await act(async () => launch.click());
  expect(openLocal).toHaveBeenCalledWith({
    agentName: "claude_code",
    keyId: "key-a",
    model: "model-a",
  });
  expect(open).not.toHaveBeenCalled();
});

it("blocks a Direct Claude launch when the overlay changed externally", async () => {
  direct = true;
  overlay = true;
  conflict = true;
  await render("claude_code");
  const launch = button("harnessConnections.marketApps.openTerminal");
  expect(launch.disabled).toBe(true);
  await act(async () => launch.click());
  expect(openLocal).not.toHaveBeenCalled();
});

it.each([
  ["native_app_restore_required", "restoreRequired"],
  ["native_app_version_unverified", "versionUnverified"],
  ["native_app_version_unverified secret-fixture", "actionFailed"],
  ["native_app_restore_required secret-fixture", "actionFailed"],
  ["backend failed with secret-fixture", "actionFailed"],
])("shows safe migration guidance for native error %s", async (code, key) => {
  connected = true;
  configure.mockRejectedValueOnce(
    new RpcError("market_connection_configure_catalog", code, code)
  );
  await render("claude_desktop");
  await act(async () => button("common:actions.edit").click());
  const provider = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.startsWith("harnessConnections.marketApps.provider")
  )!;
  await act(async () => provider.click());
  await act(async () => button("harnessConnections.apply").click());
  expect(configure).toHaveBeenCalledOnce();
  expect(Message.error).toHaveBeenCalledWith({
    content: `harnessConnections.marketApps.${key}`,
  });
  expect(Message.success).not.toHaveBeenCalled();
  // A rejected migration preserves the existing connection until explicit Restore.
  expect(restore).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  expect(button("harnessConnections.restore").disabled).toBe(false);
});

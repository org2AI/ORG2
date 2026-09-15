// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import HarnessConnectionsSection from "./HarnessConnectionsSection";

const api = vi.hoisted(() => ({ load: vi.fn(), link: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/features/MarketConnect/rpc", async (original) => ({
  ...(await original<typeof import("@src/features/MarketConnect/rpc")>()),
  loadConnections: api.load,
}));
vi.mock("@src/features/MarketConnect/deepLink", () => ({
  handleMarketConnectionUrl: api.link,
}));
vi.mock("@src/api/services/keyValidation", () => ({ saveKey: vi.fn() }));
vi.mock(
  "@src/modules/MainApp/Integrations/KeyVault/CliClients/CredentialImport/InlineCredentialImport",
  () => ({
    default: () => createElement("div", { "data-testid": "credential-import" }),
  })
);
vi.mock("@src/scaffold/WizardSystem/variants/KeyVault", () => ({
  KeyVaultWizard: () => null,
}));
vi.mock("./ClaudeProfileEditor", () => ({
  default: ({ target }: { target: string }) =>
    createElement("section", { "data-target": target }),
}));
vi.mock("./HarnessConnectionEditor", () => ({
  default: ({ agentName }: { agentName: string }) =>
    createElement("section", { "data-target": agentName }),
}));
vi.mock("./useHarnessConnection", () => ({
  refreshHarnessConnections: vi.fn(),
}));

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("makes saved Market recovery reachable from current app settings and switches ownership with the client", async () => {
  const common = {
    identity_user_id: "11111111-1111-4111-8111-111111111111",
    phase: "authorization_saved",
  };
  api.load.mockResolvedValue({
    enabled: true,
    connections: [
      { ...common, workspace_id: "ws_claude", target: "claude-code" },
      { ...common, workspace_id: "ws_codex", target: "codex" },
    ],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(HarnessConnectionsSection)));
  const button = (text: string) =>
    Array.from(container!.querySelectorAll("button")).find(
      (b) => b.textContent === text
    )!;
  const observed = vi.fn();
  window.addEventListener("market-connection-open", observed);
  try {
    expect(button("marketConnection.manage")).toBeDefined();
    await act(async () => button("marketConnection.manage").click());
    expect((observed.mock.calls[0][0] as CustomEvent).detail.workspace_id).toBe(
      "ws_claude"
    );
    await act(async () => button("Codex").click());
    await act(async () => button("marketConnection.manage").click());
    expect((observed.mock.calls[1][0] as CustomEvent).detail.workspace_id).toBe(
      "ws_codex"
    );
    await act(async () => button("Claude Desktop").click());
    expect(button("marketConnection.manage")).toBeUndefined();
  } finally {
    window.removeEventListener("market-connection-open", observed);
  }
});

it("exposes separate Desktop and CLI selectors and mounts only the selected editor", async () => {
  api.load.mockResolvedValue({ enabled: true, connections: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(HarnessConnectionsSection)));
  expect(container.querySelector("section")?.getAttribute("data-target")).toBe(
    "claude_code"
  );
  expect(container.textContent).not.toContain("harnessConnections.description");
  expect(
    container.querySelector('[data-testid="credential-import"]')
  ).not.toBeNull();
  for (const [label, target] of [
    ["Claude Desktop", "claude_desktop"],
    ["Codex", "codex"],
    ["Claude Code CLI", "claude_code"],
  ]) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === label
    )!;
    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll("section")).toHaveLength(1);
    expect(
      container.querySelector("section")?.getAttribute("data-target")
    ).toBe(target);
  }
});

it("reopens ORG2 workspace authorization without displaying global client profile controls", async () => {
  api.load.mockResolvedValue({
    enabled: true,
    connections: [
      {
        identity_user_id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "ws_org2",
        target: "org2",
        phase: "authorization_saved",
      },
    ],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(HarnessConnectionsSection)));
  const button = (label: string) =>
    [...container!.querySelectorAll("button")].find(
      (node) => node.textContent === label
    )!;
  await act(async () => button("ORG2").click());
  expect(
    container.querySelector('[data-testid="credential-import"]')
  ).toBeNull();
  expect(container.querySelector("[data-target]")).toBeNull();
  const opened = vi.fn();
  window.addEventListener("market-connection-open", opened);
  try {
    await act(async () => button("marketConnection.manage").click());
    expect(opened).toHaveBeenCalledOnce();
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      workspace_id: "ws_org2",
      target: "org2",
    });
  } finally {
    window.removeEventListener("market-connection-open", opened);
  }
});

it.each([true, false])(
  "shows an honest ORG2 empty state when module enabled=%s",
  async (enabled) => {
    api.load.mockResolvedValue({ enabled, connections: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(createElement(HarnessConnectionsSection))
    );
    const org2 = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "ORG2"
    )!;
    await act(async () => org2.click());
    expect(container.textContent).toContain(
      enabled
        ? "marketConnection.noSavedWorkspaces"
        : "marketConnection.moduleUnavailable"
    );
    expect(container.textContent).not.toContain("marketConnection.manage");
  }
);

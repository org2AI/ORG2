// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import HarnessConnectionsSection from "./HarnessConnectionsSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
vi.mock("./useHarnessConnection", () => ({
  refreshHarnessConnections: vi.fn(),
}));
vi.mock("./AppConnectionPage", () => ({
  default: () => createElement("div", { "data-testid": "market-native-apps" }),
}));
vi.mock("./ClaudeProfileEditor", () => ({
  default: ({ target }: { target: string }) =>
    createElement("section", { "data-target": target }),
}));
vi.mock("./HarnessConnectionEditor", () => ({
  default: ({ agentName }: { agentName: string }) =>
    createElement("section", { "data-target": agentName }),
}));

it("keeps Market app wiring primary and provider configuration advanced", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(HarnessConnectionsSection))
    );
    expect(
      container.querySelector('[data-testid="market-native-apps"]')
    ).not.toBeNull();
    expect(container.querySelector("section")).toBeNull();
    expect(
      container.querySelector('[data-testid="credential-import"]')
    ).toBeNull();

    const advanced = container.querySelector(
      '[data-testid="harness-connections-advanced"]'
    ) as HTMLButtonElement;
    await act(async () => advanced.click());
    expect(
      container.querySelector("section")?.getAttribute("data-target")
    ).toBe("claude_code");
    expect(
      container.querySelector('[data-testid="credential-import"]')
    ).toBeNull();
    for (const [label, target] of [
      ["Claude Desktop", "claude_desktop"],
      ["Codex", "codex"],
      ["Claude Code CLI", "claude_code"],
    ]) {
      const button = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === label
      )!;
      await act(async () => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelectorAll("section")).toHaveLength(0);
      const reopenAdvanced = [...container.querySelectorAll("button")].find(
        (item) => item.textContent === "harnessConnections.advanced"
      )!;
      await act(async () => reopenAdvanced.click());
      expect(
        container.querySelector("section")?.getAttribute("data-target")
      ).toBe(target);
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
